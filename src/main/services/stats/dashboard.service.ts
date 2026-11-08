import type { Database } from 'better-sqlite3'
import type { DashboardSummary, DashboardTrendRow } from '../../../shared/types/dashboard'
import { createArrearsService } from './arrears.service'

export type { DashboardSummary, DashboardTrendRow }

export function createDashboardService(db: Database) {
  const arrears = createArrearsService(db)
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

    // 毛利使用出库当时的成本，后续入库不会改写历史结果。
    const profitRow = db
      .prepare(
        `SELECT COALESCE(SUM(d.total_amount), 0) AS revenue,
                COALESCE(SUM((SELECT SUM(-c.change_qty * c.unit_cost) FROM cost_log c
                  WHERE c.source = d.type AND c.source_id = d.id AND c.change_qty < 0)), 0) AS cost
         FROM doc d
         WHERE d.type = 'sale' AND d.status = 'done' AND d.date = ?`
      )
      .get(date) as { revenue: number; cost: number }

    const stockAgg = db.prepare('SELECT COALESCE(SUM(qty * moving_cost), 0) AS amt FROM inventory').get() as { amt: number }
    const lowStock = db.prepare(`SELECT COUNT(*) AS count FROM product p
      WHERE p.disabled = 0 AND p.min_stock > COALESCE((SELECT SUM(i.qty) FROM inventory i WHERE i.product_id = p.id), 0)`)
      .get() as { count: number }

    // 临期/过期批次计数（批次效期，016 迁移引入的 product_batch 表）
    const today = new Date()
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const limit = new Date(today)
    limit.setDate(limit.getDate() + 30)
    const expiringAgg = db
      .prepare(
        `SELECT
           SUM(CASE WHEN expire_date >= @today THEN 1 ELSE 0 END) AS expiring,
           SUM(CASE WHEN expire_date < @today THEN 1 ELSE 0 END) AS expired
         FROM product_batch
         WHERE expire_date IS NOT NULL AND expire_date <= @limit`
      )
      .get({ today: fmt(today), limit: fmt(limit) }) as { expiring: number | null; expired: number | null }

    return {
      sales_amount: salesAgg.amt,
      sales_count: salesAgg.cnt,
      gross_profit: profitRow.revenue - profitRow.cost,
      retail_amount: retailAgg.amt,
      receipt_amount: receiptAmount,
      payment_amount: paymentAmount,
      stock_amount: stockAgg.amt,
      low_stock_count: lowStock.count,
      expiring_batch_count: expiringAgg.expiring ?? 0,
      expired_batch_count: expiringAgg.expired ?? 0,
      ...arrears.summary()
    }
  }

  /** 近 N 天（含参考日，默认今天）销售+零售合计，缺数日期补 0 */
  function trend(days: number, today?: string): DashboardTrendRow[] {
    const n = Number.isFinite(days) ? Math.min(366, Math.max(1, Math.floor(days))) : 7
    const end = today ? new Date(`${today}T00:00:00`) : new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - (n - 1))
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const startDate = fmt(start)
    const rows = db
      .prepare(
        "SELECT date, COALESCE(SUM(total_amount), 0) AS amt FROM doc WHERE type IN ('sale','retail') AND status='done' AND date BETWEEN ? AND ? GROUP BY date"
      )
      .all(startDate, fmt(end)) as { date: string; amt: number }[]
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
