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
    INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
    VALUES (@account_id, @doc_type, @doc_id, @amount, @direction, @date, @remark)
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
      if (partner != null) {
        if (!trade) throw new BizError('VALIDATION', '其他收支不计入往来余额')
        const table = type === 'receipt' ? 'customer' : 'supplier'
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(partner)) {
          throw new BizError('NOT_FOUND', type === 'receipt' ? '客户不存在' : '供应商不存在')
        }
      }
      const doc = docService.create({
        type, date: input.date, partner_id: partner,
        account_id: legs.length === 1 ? legs[0]?.id : undefined,
        remark: input.remark, items: []
      })
      const targets = new Set<number>()
      let allocated = 0
      const insertAllocation = db.prepare('INSERT INTO payment_allocation (payment_id, target_doc_id, amount) VALUES (?, ?, ?)')
      for (const row of allocations) {
        if (!trade || !partner) throw new BizError('VALIDATION', '核销前请选择客户或供应商')
        if (!row || !Number.isInteger(row.doc_id) || targets.has(row.doc_id)) throw new BizError('VALIDATION', '核销单据无效或重复')
        const outstanding = openDocuments(type, partner, row.doc_id)[0]
        const amount = cents(row.amount)
        if (!outstanding || outstanding.date > doc.date || amount > cents(outstanding.remaining)) {
          throw new BizError('VALIDATION', '待核销单据不属于此往来单位、晚于收付款日期或核销金额超出余额')
        }
        targets.add(row.doc_id)
        allocated += amount
        if (allocated > total) throw new BizError('VALIDATION', '核销金额合计不能超过单据金额')
        insertAllocation.run(doc.id, row.doc_id, amount / 100)
      }
      db.prepare('UPDATE doc SET total_amount = ? WHERE id = ?').run(total / 100, doc.id)
      for (const leg of legs) {
        insertFlow.run({
          account_id: leg.id, doc_type: type, doc_id: doc.id, amount: leg.cents / 100,
          direction, date: doc.date, remark: input.remark ?? null
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
      SELECT a.target_doc_id AS doc_id, d.no, a.amount FROM payment_allocation a
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
