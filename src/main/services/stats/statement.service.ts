import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type {
  StatementQuery,
  StatementResult,
  StatementLine,
  PartnerAgingRow,
  PartnerAgingResult,
  AgingQuery
} from '../../../shared/types/stats'

export type DB = Database

/**
 * P1 功能 #1：客商对账单明细 + 账龄分析。
 *
 * 余额口径（应收方向，customer）：
 *   余额 = 期初应收 + 销售/零售 − 收款 − 销售退货
 * 应付方向（supplier）对称：期初应付 + 采购 − 付款 − 采购退货。
 *
 * 对账单 statement()：期初余额（date_from 之前的净额）+ 逐笔行滚动余额。
 * 账龄 aging()：对每个有余额的客商，把未核销单据按单据日期分桶
 * （0-30/31-60/61-90/90+，相对 as_of）。未核销金额 = 单据金额 − payment_allocation
 * 已分配（allocation 随红冲删除，直接 SUM 即为当前有效核销）；期初余额归入 90+ 档。
 */
export function createStatementService(db: DB) {
  const round2 = (v: number): number => Math.round(v * 100) / 100

  function assertPartner(type: 'customer' | 'supplier', id: number): { id: number; name: string } {
    const table = type === 'customer' ? 'customer' : 'supplier'
    const row = db.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(id) as
      | { id: number; name: string }
      | undefined
    if (!row) throw new BizError('NOT_FOUND', type === 'customer' ? '客户不存在' : '供应商不存在')
    return row
  }

  function today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  /**
   * 往来明细行查询：返回某客商在 (date_from, date_to] 窗口内的全部单据行。
   * 客户口径：sale/retail 增（应收），receipt/sale_return 减；
   * 供应商口径：purchase 增（应付），payment/purchase_return 减。
   * 核销金额 = 该单据作为核销目标被 payment_allocation 分配的合计。
   */
  function queryLines(type: 'customer' | 'supplier', partnerId: number): StatementLine[] {
    const isCustomer = type === 'customer'
    const tradeTypes = isCustomer ? "'sale', 'retail'" : "'purchase'"
    const returnType = isCustomer ? 'sale_return' : 'purchase_return'
    const settleType = isCustomer ? 'receipt' : 'payment'
    const rows = db.prepare(`
      SELECT d.id, d.no, d.type, d.date, d.total_amount, d.remark,
        COALESCE((SELECT SUM(a.amount + a.preferential) FROM payment_allocation a JOIN doc p ON p.id = a.payment_id
          WHERE a.target_doc_id = d.id AND p.status = 'done'), 0) AS allocated
      FROM doc d
      WHERE d.partner_id = @pid AND d.status = 'done'
        AND d.type IN (${tradeTypes}, @returnType, @settleType)
      ORDER BY d.date, d.id
    `).all({ pid: partnerId, returnType, settleType }) as
      { id: number; no: string; type: string; date: string; total_amount: number; remark: string | null; allocated: number }[]

    return rows.map((r) => {
      const decrease = r.type === returnType || r.type === settleType
      return {
        date: r.date,
        no: r.no,
        type: r.type,
        amount: round2(Math.abs(r.total_amount)),
        direction: decrease ? 'decrease' : 'increase',
        allocated: round2(r.allocated),
        balance: 0,
        doc_id: r.id,
        remark: r.remark
      }
    })
  }

  function statement(query: StatementQuery): StatementResult {
    const isCustomer = query.partner_type === 'customer'
    const partner = assertPartner(query.partner_type, query.partner_id)
    const openingCol = isCustomer ? 'opening_receivable' : 'opening_payable'
    const openingTotal = Number(
      (db.prepare(`SELECT ${openingCol} AS v FROM ${isCustomer ? 'customer' : 'supplier'} WHERE id = ?`)
        .get(query.partner_id) as { v: number }).v ?? 0
    )

    const allLines = queryLines(query.partner_type, query.partner_id)
    const dateFrom = query.date_from ?? null
    const dateTo = query.date_to ?? null

    // 期初余额 = 期初 + date_from 之前所有行的净额
    let opening = openingTotal
    const lines: StatementLine[] = []
    for (const line of allLines) {
      if (dateFrom && line.date < dateFrom) {
        opening += line.direction === 'increase' ? line.amount : -line.amount
        continue
      }
      if (dateTo && line.date > dateTo) continue
      lines.push(line)
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.doc_id - b.doc_id)

    let balance = round2(opening)
    for (const line of lines) {
      balance = round2(balance + (line.direction === 'increase' ? line.amount : -line.amount))
      line.balance = balance
    }

    return {
      partner_id: partner.id,
      partner_name: partner.name,
      partner_type: query.partner_type,
      date_from: dateFrom,
      date_to: dateTo,
      opening_balance: round2(opening),
      lines,
      closing_balance: balance
    }
  }

  /**
   * 账龄分析：把每个有余额客商的未核销单据金额按单据日期分桶。
   * 未核销金额 = 单据金额 − payment_allocation 已分配（红冲单已删核销行，直接 SUM）。
   * 期初余额作为"最老"欠款归入 90+ 档。
   */
  function aging(query: AgingQuery): PartnerAgingResult {
    const isCustomer = query.partner_type === 'customer'
    const asOf = query.as_of ?? today()
    const openingCol = isCustomer ? 'opening_receivable' : 'opening_payable'
    const table = isCustomer ? 'customer' : 'supplier'
    const tradeTypes = isCustomer ? "'sale', 'retail'" : "'purchase'"
    const returnType = isCustomer ? 'sale_return' : 'purchase_return'

    const rows = db.prepare(`
      SELECT p.id AS partner_id, p.name AS partner_name,
        p.${openingCol} AS opening,
        d.id AS doc_id, d.date AS doc_date, d.type,
        CASE WHEN d.type = @returnType THEN -d.total_amount ELSE d.total_amount END AS amount,
        COALESCE((SELECT SUM(a.amount + a.preferential) FROM payment_allocation a JOIN doc pp ON pp.id = a.payment_id
          WHERE a.target_doc_id = d.id AND pp.status = 'done'), 0) AS allocated
      FROM ${table} p
      JOIN doc d ON d.partner_id = p.id AND p.disabled = 0
      WHERE d.status = 'done' AND d.date <= @asOf AND d.type IN (${tradeTypes}, @returnType)
    `).all({ returnType, asOf }) as {
      partner_id: number; partner_name: string; opening: number;
      doc_id: number; doc_date: string; type: string; amount: number; allocated: number
    }[]

    const bucketOf = (date: string): 'bucket_0_30' | 'bucket_31_60' | 'bucket_61_90' | 'bucket_90p' => {
      const days = Math.floor((Date.parse(asOf) - Date.parse(date)) / 86400000)
      return days <= 30 ? 'bucket_0_30' : days <= 60 ? 'bucket_31_60' : days <= 90 ? 'bucket_61_90' : 'bucket_90p'
    }

    const byPartner = new Map<number, PartnerAgingRow>()
    const ensure = (id: number, name: string): PartnerAgingRow => {
      let row = byPartner.get(id)
      if (!row) {
        row = { partner_id: id, partner_name: name, balance: 0, bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90p: 0 }
        byPartner.set(id, row)
      }
      return row
    }

    for (const r of rows) {
      // 退货单金额为负向冲减；未核销金额 = 金额 − 已分配（不为负）
      const unsettled = round2(r.amount - r.allocated)
      if (unsettled === 0) continue
      const row = ensure(r.partner_id, r.partner_name)
      const bucket = r.type === returnType ? 'bucket_90p' : bucketOf(r.doc_date)
      row[bucket] = round2(row[bucket] + unsettled)
      row.balance = round2(row.balance + unsettled)
    }

    // 期初余额归入 90+ 档
    const openings = db.prepare(
      `SELECT id, name, ${openingCol} AS opening FROM ${table} WHERE disabled = 0 AND ${openingCol} <> 0`
    ).all() as { id: number; name: string; opening: number }[]
    for (const o of openings) {
      const row = ensure(o.id, o.name)
      row.bucket_90p = round2(row.bucket_90p + o.opening)
      row.balance = round2(row.balance + o.opening)
    }

    const list = [...byPartner.values()].filter((r) => r.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
    const total: PartnerAgingRow = {
      partner_id: 0,
      partner_name: '合计',
      balance: round2(list.reduce((s, r) => s + r.balance, 0)),
      bucket_0_30: round2(list.reduce((s, r) => s + r.bucket_0_30, 0)),
      bucket_31_60: round2(list.reduce((s, r) => s + r.bucket_31_60, 0)),
      bucket_61_90: round2(list.reduce((s, r) => s + r.bucket_61_90, 0)),
      bucket_90p: round2(list.reduce((s, r) => s + r.bucket_90p, 0))
    }
    return { as_of: asOf, rows: list, total }
  }

  return { statement, aging }
}

export type StatementService = ReturnType<typeof createStatementService>
