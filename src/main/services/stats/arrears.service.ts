import type { Database } from 'better-sqlite3'
import type { ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'

export type DB = Database

interface PartnerRow {
  id: number
  name: string
}

/**
 * 应收应付统计（纯查询服务）。
 * 应收余额 = 客户期初应收 + Σ销售单金额 − Σ资金流入（收款单/零售收款）。
 * 应付余额 = 供应商期初应付 + Σ进货单金额 − Σ资金流出（付款单）。
 * 零售流水（doc_type='retail'，direction='in'）计入已收：柜台零售即收即付；
 * 零售散客 partner_id 为空，自然不参与客户维度统计。
 */
export function createArrearsService(db: DB) {
  const receivables = (): ArrearsRow[] => {
    const customers = db
      .prepare('SELECT id, name FROM customer WHERE disabled = 0 ORDER BY id')
      .all() as PartnerRow[]
    const sales = db
      .prepare(
        "SELECT partner_id, SUM(total_amount) AS amt FROM doc WHERE type = 'sale' AND partner_id IS NOT NULL GROUP BY partner_id"
      )
      .all() as { partner_id: number; amt: number | null }[]
    // fund_flow 无 partner_id 列，经 doc 关联（doc_id + doc_type → doc.partner_id）
    const receivedViaDoc = db
      .prepare(
        "SELECT d.partner_id AS partner_id, SUM(f.amount) AS amt FROM fund_flow f JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type WHERE f.direction = 'in' AND f.doc_type IN ('receipt', 'retail') AND d.partner_id IS NOT NULL GROUP BY d.partner_id"
      )
      .all() as { partner_id: number; amt: number | null }[]

    const salesMap = new Map(sales.map((r) => [r.partner_id, r.amt ?? 0]))
    const recvMap = new Map<number, number>()
    for (const r of receivedViaDoc) recvMap.set(r.partner_id, (recvMap.get(r.partner_id) ?? 0) + (r.amt ?? 0))

    const rows: ArrearsRow[] = customers.map((c) => {
      const opening = Number(
        (db.prepare('SELECT opening_receivable FROM customer WHERE id = ?').get(c.id) as { opening_receivable: number })
          .opening_receivable
      )
      const amount = salesMap.get(c.id) ?? 0
      const settled = recvMap.get(c.id) ?? 0
      return { partner_id: c.id, partner_name: c.name, opening, amount, settled, balance: opening + amount - settled }
    })
    return rows.sort((a, b) => b.balance - a.balance)
  }

  const payables = (): ArrearsRow[] => {
    const suppliers = db
      .prepare('SELECT id, name FROM supplier WHERE disabled = 0 ORDER BY id')
      .all() as PartnerRow[]
    const purchases = new Map(
      (
        db
          .prepare(
            "SELECT partner_id, SUM(total_amount) AS amt FROM doc WHERE type = 'purchase' AND partner_id IS NOT NULL GROUP BY partner_id"
          )
          .all() as { partner_id: number; amt: number | null }[]
      ).map((r) => [r.partner_id, r.amt ?? 0])
    )
    const paidMap = new Map(
      (
        db
          .prepare(
            "SELECT d.partner_id AS partner_id, SUM(f.amount) AS amt FROM fund_flow f JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type WHERE f.direction = 'out' AND f.doc_type = 'payment' AND d.partner_id IS NOT NULL GROUP BY d.partner_id"
          )
          .all() as { partner_id: number; amt: number | null }[]
      ).map((r) => [r.partner_id, r.amt ?? 0])
    )

    const rows: ArrearsRow[] = suppliers.map((s) => {
      const opening = Number(
        (db.prepare('SELECT opening_payable FROM supplier WHERE id = ?').get(s.id) as { opening_payable: number })
          .opening_payable
      )
      const amount = purchases.get(s.id) ?? 0
      const settled = paidMap.get(s.id) ?? 0
      return { partner_id: s.id, partner_name: s.name, opening, amount, settled, balance: opening + amount - settled }
    })
    return rows.sort((a, b) => b.balance - a.balance)
  }

  const summary = (): ArrearsSummary => {
    const sum = (rows: ArrearsRow[]): number => rows.reduce((acc, r) => acc + r.balance, 0)
    return { total_receivable: sum(receivables()), total_payable: sum(payables()) }
  }

  return { receivables, payables, summary }
}

export type ArrearsService = ReturnType<typeof createArrearsService>
