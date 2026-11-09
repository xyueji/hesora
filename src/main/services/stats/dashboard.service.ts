import type { Database } from 'better-sqlite3'
import type {
  DashboardSummary,
  DashboardTrendRow,
  ReminderItem,
  TodayBrief
} from '../../../shared/types/dashboard'
import { createArrearsService } from './arrears.service'

export type { DashboardSummary, DashboardTrendRow, ReminderItem, TodayBrief }

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

  /** [5] 日报速览：昨日/今日库存量、今日销售出库量、今日入库量（S 级功能批次 B）
   *  口径：
   *  - today_stock_qty：实时 Σ inventory.qty（所有仓）
   *  - yesterday_stock_qty = today_stock_qty − 今日净变动（今日入库 − 今日出库），
   *    变动统一从 cost_log 取（所有库存变动必经 inventory+cost_log，见 AGENTS.md §4）
   *  - today_in_qty = 采购入库 + 销售退货入库（cost_log change_qty>0 且 source 归属）
   *  - today_sale_qty = 销售出库量（cost_log change_qty<0 且 source='sale'）
   */
  function todayBrief(date: string): TodayBrief {
    // 单据发生日（d.date）作为口径基准：cost_log.created_at 是入库时间，与单据日期可能不同天。
    const moveAgg = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN c.change_qty > 0 THEN c.change_qty ELSE 0 END), 0) AS in_qty,
           COALESCE(SUM(CASE WHEN c.change_qty < 0 THEN -c.change_qty ELSE 0 END), 0) AS out_qty
         FROM cost_log c
         JOIN doc d ON d.id = c.source_id AND d.type = c.source
         WHERE d.date = ? AND c.source IN ('purchase','sale','sale_return','purchase_return')`
      )
      .get(date) as { in_qty: number; out_qty: number }
    const saleOut = db
      .prepare(
        `SELECT COALESCE(SUM(-c.change_qty), 0) AS qty FROM cost_log c
         JOIN doc d ON d.id = c.source_id AND d.type = c.source
         WHERE d.date = ? AND c.source = 'sale' AND c.change_qty < 0`
      )
      .get(date) as { qty: number }
    const totalAgg = db.prepare('SELECT COALESCE(SUM(qty), 0) AS qty FROM inventory').get() as { qty: number }
    const todayStock = totalAgg.qty
    const inQty = moveAgg.in_qty
    const outQty = moveAgg.out_qty
    return {
      yesterday_stock_qty: todayStock - (inQty - outQty),
      today_sale_qty: saleOut.qty,
      today_in_qty: inQty,
      today_stock_qty: todayStock
    }
  }

  /** [6] 首页待办提醒聚合：库存预警 / 往来欠款 / 批次临期（S 级功能批次 B）
   *  复用 summary() 内的库存预警与临期口径；欠款复用 arrears.summary()。
   */
  function reminders(): ReminderItem[] {
    // 库存预警：低于最低库存的商品，附缺口明细（最多 10 条）
    const lowStockRows = db
      .prepare(
        `SELECT p.name AS product_name,
                p.min_stock - COALESCE((SELECT SUM(i.qty) FROM inventory i WHERE i.product_id = p.id), 0) AS shortage
         FROM product p
         WHERE p.disabled = 0 AND p.min_stock > COALESCE((SELECT SUM(i.qty) FROM inventory i WHERE i.product_id = p.id), 0)
         ORDER BY shortage DESC LIMIT 10`
      )
      .all() as { product_name: string; shortage: number }[]
    const lowStockCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM product p
         WHERE p.disabled = 0 AND p.min_stock > COALESCE((SELECT SUM(i.qty) FROM inventory i WHERE i.product_id = p.id), 0)`
      )
      .get() as { count: number }

    // 临期批次（未来 30 天，与 summary 同口径，不含已过期）
    const todayD = new Date()
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const limitD = new Date(todayD)
    limitD.setDate(limitD.getDate() + 30)
    const expiringAgg = db
      .prepare(
        `SELECT COUNT(*) AS count FROM product_batch
         WHERE expire_date IS NOT NULL AND expire_date >= @today AND expire_date <= @limit`
      )
      .get({ today: fmt(todayD), limit: fmt(limitD) }) as { count: number }

    // 欠款：应收+应付存在任一非零即计数 1（跳转往来页处理）
    const ar = arrears.summary()
    const arrearsCount = (ar.total_receivable > 0.005 ? 1 : 0) + (ar.total_payable > 0.005 ? 1 : 0)

    return [
      {
        type: 'stock_warn',
        count: lowStockCount.count,
        items: lowStockRows.map((r) => ({ product_name: r.product_name, shortage: r.shortage }))
      },
      { type: 'arrears', count: arrearsCount },
      { type: 'expiring', count: expiringAgg.count }
    ]
  }

  return { summary, trend, todayBrief, reminders }
}

export type DashboardService = ReturnType<typeof createDashboardService>
