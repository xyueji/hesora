import type { Database } from 'better-sqlite3'
import type { DashboardSummary, DashboardTrendRow } from '../../../shared/types/dashboard'

export type { DashboardSummary, DashboardTrendRow }

/**
 * 经营仪表盘统计（纯查询服务）。
 * 应收/应付合计复用 arrears.service 同一套聚合 SQL（此处内联最小实现，避免跨域服务依赖）。
 */
export function createDashboardService(db: Database) {
  function summary(date: string): DashboardSummary {
    const salesAgg = db
      .prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS amt FROM doc WHERE type = 'sale' AND status = 'done' AND date = ?"
      )
      .get(date) as { cnt: number; amt: number }
    const retailAgg = db
      .prepare("SELECT COALESCE(SUM(total_amount), 0) AS amt FROM doc WHERE type = 'retail' AND status = 'done' AND date = ?")
      .get(date) as { amt: number }
    const flowAgg = db
      .prepare("SELECT direction, COALESCE(SUM(amount), 0) AS amt FROM fund_flow WHERE date = ? AND doc_type IN ('receipt','payment') GROUP BY direction")
      .all(date) as { direction: string; amt: number }[]
    let receiptAmount = 0
    let paymentAmount = 0
    for (const r of flowAgg) {
      if (r.direction === 'in') receiptAmount = r.amt
      if (r.direction === 'out') paymentAmount = r.amt
    }

    // 毛利：销售明细 amount − qty*rate × 同(仓库,批号)库存行当前移动加权成本
    const profitRow = db
      .prepare(
        `SELECT COALESCE(SUM(di.amount), 0) AS revenue,
                COALESCE(SUM(di.qty * di.rate * COALESCE(inv.moving_cost, 0)), 0) AS cost
         FROM doc d
         JOIN doc_item di ON di.doc_id = d.id
         LEFT JOIN inventory inv
           ON inv.product_id = di.product_id
          AND inv.warehouse_id = d.warehouse_id
          AND inv.batch_no = di.batch_no
         WHERE d.type = 'sale' AND d.status = 'done' AND d.date = ?`
      )
      .get(date) as { revenue: number; cost: number }

    const stockAgg = db.prepare('SELECT COALESCE(SUM(qty * moving_cost), 0) AS amt FROM inventory').get() as { amt: number }

    // 应收/应付合计（与 arrears.service 同口径的聚合 SQL）
    const recvRow = db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(opening_receivable),0) FROM customer)
              + (SELECT COALESCE(SUM(total_amount),0) FROM doc WHERE type='sale' AND status='done' AND partner_id IS NOT NULL)
              - (SELECT COALESCE(SUM(f.amount),0) FROM fund_flow f JOIN doc d ON d.id=f.doc_id AND d.type=f.doc_type
                 WHERE f.direction='in' AND f.doc_type IN ('receipt','retail') AND d.partner_id IS NOT NULL) AS bal`
      )
      .get() as { bal: number }
    const payRow = db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(opening_payable),0) FROM supplier)
              + (SELECT COALESCE(SUM(total_amount),0) FROM doc WHERE type='purchase' AND status='done' AND partner_id IS NOT NULL)
              - (SELECT COALESCE(SUM(f.amount),0) FROM fund_flow f JOIN doc d ON d.id=f.doc_id AND d.type=f.doc_type
                 WHERE f.direction='out' AND f.doc_type='payment' AND d.partner_id IS NOT NULL) AS bal`
      )
      .get() as { bal: number }

    return {
      sales_amount: salesAgg.amt,
      sales_count: salesAgg.cnt,
      gross_profit: profitRow.revenue - profitRow.cost,
      retail_amount: retailAgg.amt,
      receipt_amount: receiptAmount,
      payment_amount: paymentAmount,
      stock_amount: stockAgg.amt,
      total_receivable: recvRow.bal,
      total_payable: payRow.bal
    }
  }

  /** 近 N 天（含参考日，默认今天）销售+零售合计，缺数日期补 0 */
  function trend(days: number, today?: string): DashboardTrendRow[] {
    const n = Math.max(1, Math.floor(Number(days)))
    const end = today ? new Date(`${today}T00:00:00`) : new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - (n - 1))
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const startDate = fmt(start)
    const rows = db
      .prepare(
        "SELECT date, COALESCE(SUM(total_amount), 0) AS amt FROM doc WHERE type IN ('sale','retail') AND status='done' AND date >= ? GROUP BY date"
      )
      .all(startDate) as { date: string; amt: number }[]
    const map = new Map(rows.map((r) => [r.date, r.amt]))
    const out: DashboardTrendRow[] = []
    const cursor = new Date(start)
    for (let i = 0; i < n; i++) {
      const d = fmt(cursor)
      out.push({ date: d, amount: map.get(d) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }

  return { summary, trend }
}

export type DashboardService = ReturnType<typeof createDashboardService>
