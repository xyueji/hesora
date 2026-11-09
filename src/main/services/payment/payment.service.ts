import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { DOC_TYPE_LABELS } from '../../../shared/types/doc'
import type { DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import type { FundFlowRow, PaymentCreateInput, PaymentDetail, PaymentType, SettlementDocument } from '../../../shared/types/payment'
import { createDocService, type DocService } from '../doc/doc.service'

export type DB = Database

interface FlowDbRow {
  id: number
  account_id: number
  doc_type: string
  doc_id: number
  amount: number
  direction: string
  date: string
  remark: string | null
  created_at: string
}

function toFlowRow(row: FlowDbRow): FundFlowRow {
  return { ...row, direction: row.direction as FundFlowRow['direction'] }
}

/**
 * 收付款单服务：收款单（type=receipt，编号 SK…，资金流入）与付款单（type=payment，编号 FK…，资金流出）。
 * 不涉及商品明细（doc_item 为空），金额记在 doc.total_amount，同时写入资金流水 fund_flow。
 */
export function createPaymentService(db: DB) {
  const docService: DocService = createDocService(db)
  const insertFlow = db.prepare(`
    INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark, category_id)
    VALUES (@account_id, @doc_type, @doc_id, @amount, @direction, @date, @remark, @category_id)
  `)

  function cents(amount: number): number {
    const result = Math.round(amount * 100)
    if (!Number.isSafeInteger(result) || result <= 0 || Math.abs(amount * 100 - result) > 1e-7) {
      throw new BizError('VALIDATION', '金额必须大于0且最多保留两位小数')
    }
    return result
  }

  function openDocuments(type: 'receipt' | 'payment', partnerId: number, id?: number): SettlementDocument[] {
    if (type !== 'receipt' && type !== 'payment') throw new BizError('VALIDATION', '核销单据类型无效')
    const tradeType = type === 'receipt' ? 'sale' : 'purchase'
    const returnType = type === 'receipt' ? 'sale_return' : 'purchase_return'
    const refundDirection = type === 'receipt' ? 'out' : 'in'
    return db.prepare(`
      WITH remaining_docs AS (
        SELECT d.id, d.no, d.date, d.total_amount,
          ROUND(d.total_amount - COALESCE((
            SELECT SUM(a.amount) FROM payment_allocation a JOIN doc p ON p.id = a.payment_id
            WHERE a.target_doc_id = d.id AND p.status = 'done'
          ), 0) - COALESCE((
            SELECT SUM(a.preferential) FROM payment_allocation a JOIN doc p ON p.id = a.payment_id
            WHERE a.target_doc_id = d.id AND p.status = 'done'
          ), 0) - COALESCE((
            SELECT SUM(r.total_amount - COALESCE((
              SELECT SUM(f.amount) FROM fund_flow f WHERE f.doc_id = r.id AND f.doc_type = r.type
                AND f.direction = @refundDirection AND f.account_id = r.account_id
            ), 0)) FROM doc r WHERE r.source_doc_id = d.id AND r.type = @returnType AND r.status = 'done'
          ), 0), 2) AS remaining
        FROM doc d WHERE d.type = @tradeType AND d.partner_id = @partnerId AND d.status = 'done'
          AND (@id IS NULL OR d.id = @id)
      ) SELECT * FROM remaining_docs WHERE remaining > 0 ORDER BY date, id LIMIT 200
    `).all({ tradeType, returnType, refundDirection, partnerId, id: id ?? null }) as SettlementDocument[]
  }

  function createOne(type: PaymentType, input: PaymentCreateInput): DocRow {
    if (!['receipt', 'payment', 'other_in', 'other_out'].includes(type)) {
      throw new BizError('VALIDATION', '无效的资金单据类型')
    }
    if (!input || (input.accounts !== undefined && !Array.isArray(input.accounts)) ||
        (input.allocations !== undefined && !Array.isArray(input.allocations))) {
      throw new BizError('VALIDATION', '资金单据明细格式无效')
    }
    const total = cents(input.amount)
    const accounts = input.accounts ?? [{ account_id: input.account_id, amount: input.amount }]
    if (!accounts.length || accounts.length > 20) throw new BizError('VALIDATION', '请选择 1 至 20 个结算账户')
    const allocations = input.allocations ?? []
    if (allocations.length > 200) throw new BizError('VALIDATION', '单次最多核销 200 张单据')
    const trade = type === 'receipt' || type === 'payment'
    const direction = type === 'receipt' || type === 'other_in' ? 'in' : 'out'
    return db.transaction(() => {
      const accountIds = new Set<number>()
      const accountQuery = db.prepare('SELECT 1 FROM fund_account WHERE id = ? AND disabled = 0')
      const legs = accounts.map((row) => {
        const id = row?.account_id
        if (typeof id !== 'number' || !Number.isInteger(id)) throw new BizError('VALIDATION', '结算账户不能为空')
        if (accountIds.has(id)) throw new BizError('VALIDATION', '同一资金账户只能选择一次')
        if (!accountQuery.get(id)) throw new BizError('NOT_FOUND', '账户不存在或已停用')
        accountIds.add(id)
        return { id, cents: cents(row.amount) }
      })
      if (legs.reduce((sum, row) => sum + row.cents, 0) !== total) {
        throw new BizError('VALIDATION', '结算账户金额合计必须等于单据金额')
      }
      const partner = input.partner_id
      // P1 功能 #2 预存款：charge_type 仅对收付款类单据有效
      const chargeType = input.charge_type ?? 'normal'
      const prepaidMode = chargeType === 'prepaid' || chargeType === 'prepaid_refund'
      if (prepaidMode && !trade) throw new BizError('VALIDATION', '预存款模式仅适用于收付款单')
      if (prepaidMode && partner == null) throw new BizError('VALIDATION', '预存款收付款必须选择客户或供应商')
      if (partner != null) {
        if (!trade) throw new BizError('VALIDATION', '其他收支不计入往来余额')
        const table = type === 'receipt' ? 'customer' : 'supplier'
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(partner)) {
          throw new BizError('NOT_FOUND', type === 'receipt' ? '客户不存在' : '供应商不存在')
        }
      }
      // [10] 科目：可选 category_id，须为存在的 income_category（S 级功能批次 B）
      const categoryId = input.category_id
      if (categoryId != null) {
        if (!Number.isInteger(categoryId) || !db.prepare('SELECT 1 FROM income_category WHERE id = ?').get(categoryId)) {
          throw new BizError('NOT_FOUND', '收支科目不存在')
        }
      }
      const doc = docService.create({
        type, date: input.date, partner_id: partner,
        account_id: legs.length === 1 ? legs[0]?.id : undefined,
        remark: input.remark, items: []
      })
      if (prepaidMode) {
        // docService.create 不写 charge_type，这里落列（默认 'normal'）
        db.prepare('UPDATE doc SET charge_type = ? WHERE id = ?').run(chargeType, doc.id)
      }
      const targets = new Set<number>()
      let allocated = 0
      // 让利闭环：销账合计（含优惠）上限 = 实收金额 + 各单未核销余额（允许全优惠清账）
      let settledTotal = 0
      const allocatedTotal = (() => {
        if (!trade || !partner) return 0
        const row = db.prepare(
          `SELECT COALESCE(SUM(d.total_amount - IFNULL((
             SELECT SUM(a.amount + a.preferential) FROM payment_allocation a
             JOIN doc p ON p.id = a.payment_id WHERE a.target_doc_id = d.id AND p.status = 'done'
           ), 0)), 0) AS remaining
           FROM doc d WHERE d.partner_id = ? AND d.type IN ('sale','purchase','retail','purchase_return','sale_return') AND d.status = 'done'`
        ).get(partner) as { remaining: number }
        return Math.max(0, Math.round((row?.remaining ?? 0) * 100))
      })()
      // 让利闭环：核销行可带优惠金额（allocation.amount + preferential = 本次销账金额）
      const insertAllocation = db.prepare('INSERT INTO payment_allocation (payment_id, target_doc_id, amount, preferential) VALUES (?, ?, ?, ?)')
      if (prepaidMode && allocations.length > 0) {
        throw new BizError('VALIDATION', '预存款收付款不参与核销')
      }
      for (const row of allocations) {
        if (!trade || !partner) throw new BizError('VALIDATION', '核销前请选择客户或供应商')
        if (!row || !Number.isInteger(row.doc_id) || targets.has(row.doc_id)) throw new BizError('VALIDATION', '核销单据无效或重复')
        const outstanding = openDocuments(type, partner, row.doc_id)[0]
        const amount = cents(row.amount)
        // 让利闭环：本次销账金额 = 核销金额 + 优惠金额，允许优惠部分核销（不必精确等额）
        const preferential = row.preferential !== undefined && row.preferential !== null ? cents(row.preferential) : 0
        const settle = amount + preferential
        if (!outstanding || outstanding.date > doc.date || settle > cents(outstanding.remaining)) {
          throw new BizError('VALIDATION', '待核销单据不属于此往来单位、晚于收付款日期或核销金额（含优惠）超出余额')
        }
        if (settle === amount && amount === 0) throw new BizError('VALIDATION', '核销金额必须大于0')
        targets.add(row.doc_id)
        // 让利闭环：优惠部分不占用实收现金，仅实收金额合计受单据金额约束；
        // 销账合计（含优惠）则允许超出单据金额直至覆盖未核销余额
        allocated += amount
        if (allocated > total) throw new BizError('VALIDATION', '核销金额合计不能超过单据金额')
        settledTotal += settle
        if (settledTotal > allocatedTotal + total) {
          throw new BizError('VALIDATION', '核销金额（含优惠）超出单据金额与待核销余额')
        }
        insertAllocation.run(doc.id, row.doc_id, amount / 100, preferential / 100)
      }
      db.prepare('UPDATE doc SET total_amount = ? WHERE id = ?').run(total / 100, doc.id)
      // P1 功能 #2 预存款过账：计入/退回预存款，更新 partner.prepaid，不写核销
      if (prepaidMode && partner != null) {
        const table = type === 'receipt' ? 'customer' : 'supplier'
        const delta = chargeType === 'prepaid' ? total / 100 : -(total / 100)
        const row = db.prepare(`SELECT prepaid FROM ${table} WHERE id = ?`).get(partner) as { prepaid: number } | undefined
        const current = row?.prepaid ?? 0
        if (delta < 0 && current + delta < 0) {
          throw new BizError('PREPAID_INSUFFICIENT', `预存款不足：当前余额 ${current.toFixed(2)} 元，无法退回 ${(-delta).toFixed(2)} 元`)
        }
        db.prepare(`UPDATE ${table} SET prepaid = prepaid + ? WHERE id = ?`).run(delta, partner)
      }
      for (const leg of legs) {
        insertFlow.run({
          account_id: leg.id, doc_type: type, doc_id: doc.id, amount: leg.cents / 100,
          direction, date: doc.date, remark: input.remark ?? null,
          category_id: categoryId ?? null // [10] 资金流水关联收支科目
        })
      }
      return { ...doc, total_amount: total / 100 }
    }).immediate()
  }

  /** 收款单：客户付款流入，编号 SKyyyyMMddNNNN */
  function createReceipt(input: PaymentCreateInput): DocRow {
    return createOne('receipt', input)
  }

  /** 付款单：向供应商付款流出，编号 FKyyyyMMddNNNN */
  function createPayment(input: PaymentCreateInput): DocRow {
    return createOne('payment', input)
  }

  function getDetail(type: PaymentType, id: number): PaymentDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== type) {
      throw new BizError('NOT_FOUND', `${DOC_TYPE_LABELS[type]}不存在：${id}`)
    }
    const flows = (db.prepare(`SELECT f.*, a.name AS account_name FROM fund_flow f
      LEFT JOIN fund_account a ON a.id = f.account_id WHERE f.doc_id = ? AND f.doc_type = ? ORDER BY f.id`)
      .all(id, type) as FlowDbRow[]).map(toFlowRow)
    const allocations = db.prepare(`
      SELECT a.target_doc_id AS doc_id, d.no, a.amount, a.preferential FROM payment_allocation a
      JOIN doc d ON d.id = a.target_doc_id WHERE a.payment_id = ? ORDER BY d.date, d.id
    `).all(id) as PaymentDetail['allocations']
    return { doc, flow: flows[0] ?? null, flows, allocations }
  }

  function query(
    type: PaymentType,
    q: Omit<DocQuery, 'type'>
  ): DocPageResult {
    return docService.query({ ...q, type })
  }

  return {
    createOne,
    openDocuments,
    createReceipt,
    createPayment,
    getDetail,
    query,
    getReceiptDetail: (id: number) => getDetail('receipt', id),
    getPaymentDetail: (id: number) => getDetail('payment', id),
    queryReceipt: (q: Omit<DocQuery, 'type'>) => query('receipt', q),
    queryPayment: (q: Omit<DocQuery, 'type'>) => query('payment', q)
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
