import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

/** 月度汇总行（month=0 为全年合计行） */
export interface MonthlyStockRow {
  month: number
  opening_qty: number
  opening_amount: number
  in_qty: number
  in_amount: number
  out_qty: number
  out_amount: number
  ending_qty: number
  ending_amount: number
}

export interface MonthlyStockQuery {
  year: number
  warehouse_id?: number | null
  product_id?: number | null
}

interface MonthlyAgg {
  in_qty: number
  in_amount: number
  out_qty: number
  out_amount: number
}

/**
 * 月度库存汇总表（M 级功能）。
 *
 * 口径（与成本变动明细一致，均基于 cost_log）：
 * - 入库数量/金额 = Σ(change_qty > 0 的 change_qty / change_qty*unit_cost)
 * - 出库数量/金额 = Σ(change_qty < 0 的 -change_qty / -change_qty*unit_cost)
 * - 期初（金额近似，移动加权简化）= 开账起至上月末：累计入金额 - 累计出金额
 * - 期末 = 期初 + 本月入 - 本月出
 *
 * 输出全年 1-12 月（无变动月数值承前）+ month=0 的全年合计行，符合商户月结习惯。
 */
export function createMonthlyService(db: Database) {
  function monthlyStockSummary(query: MonthlyStockQuery): MonthlyStockRow[] {
    const year = Math.trunc(Number(query?.year))
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      throw new BizError('VALIDATION', '请选择有效的年份')
    }
    const warehouseId = query.warehouse_id ?? null
    const productId = query.product_id ?? null
    // 归月日期：cost_log.created_at 是写入时刻（补录历史单会落错月），
    // 优先取关联单据的 d.date（source+source_id 对应 doc.type+doc.id），期初建账等无单据记录回退 created_at。
    const docDate = `COALESCE((SELECT d.date FROM doc d WHERE d.id = c.source_id AND d.type = c.source), substr(c.created_at, 1, 10))`
    const where: string[] = [
      `${docDate} >= @year_from`,
      `${docDate} < @next_year`
    ]
    if (warehouseId !== null) where.push('c.warehouse_id = @warehouse_id')
    if (productId !== null) where.push('c.product_id = @product_id')
    const monthAgg = db
      .prepare(
        `SELECT CAST(substr(${docDate}, 6, 2) AS INTEGER) AS month,
          COALESCE(SUM(CASE WHEN c.change_qty > 0 THEN c.change_qty ELSE 0 END), 0) AS in_qty,
          COALESCE(SUM(CASE WHEN c.change_qty > 0 THEN c.change_qty * c.unit_cost ELSE 0 END), 0) AS in_amount,
          COALESCE(SUM(CASE WHEN c.change_qty < 0 THEN -c.change_qty ELSE 0 END), 0) AS out_qty,
          COALESCE(SUM(CASE WHEN c.change_qty < 0 THEN -c.change_qty * c.unit_cost ELSE 0 END), 0) AS out_amount
        FROM cost_log c WHERE ${where.join(' AND ')}
        GROUP BY month`
      )
      .all({
        year_from: `${year}-01-01`,
        next_year: `${year + 1}-01-01`,
        warehouse_id: warehouseId,
        product_id: productId
      }) as Array<MonthlyAgg & { month: number }>
    const byMonth = new Map<number, MonthlyAgg>(monthAgg.map((r) => [r.month, r]))

    // 期初：开账起至上年 12-31 累计净量与累计入金额-出金额
    const preWhere = where.slice(2)
    const opening = db
      .prepare(
        `SELECT COALESCE(SUM(c.change_qty), 0) AS qty,
          COALESCE(SUM(CASE WHEN c.change_qty > 0 THEN c.change_qty * c.unit_cost ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN c.change_qty < 0 THEN -c.change_qty * c.unit_cost ELSE 0 END), 0) AS amount
        FROM cost_log c WHERE ${docDate} < @year_from${preWhere.length ? ` AND ${preWhere.join(' AND ')}` : ''}`
      )
      .get({
        year_from: `${year}-01-01`,
        warehouse_id: warehouseId,
        product_id: productId
      }) as { qty: number; amount: number }

    const rows: MonthlyStockRow[] = []
    let openingQty = opening.qty
    let openingAmount = opening.amount
    for (let m = 1; m <= 12; m++) {
      const agg = byMonth.get(m) ?? { in_qty: 0, in_amount: 0, out_qty: 0, out_amount: 0 }
      const endingQty = openingQty + agg.in_qty - agg.out_qty
      const endingAmount = openingAmount + agg.in_amount - agg.out_amount
      rows.push({
        month: m,
        opening_qty: openingQty,
        opening_amount: openingAmount,
        in_qty: agg.in_qty,
        in_amount: agg.in_amount,
        out_qty: agg.out_qty,
        out_amount: agg.out_amount,
        ending_qty: endingQty,
        ending_amount: endingAmount
      })
      openingQty = endingQty
      openingAmount = endingAmount
    }
    const first = rows[0] ?? { opening_qty: 0, opening_amount: 0, in_qty: 0, in_amount: 0, out_qty: 0, out_amount: 0, ending_qty: 0, ending_amount: 0, month: 1 }
    const last = rows[11] ?? first
    rows.push({
      month: 0,
      opening_qty: first.opening_qty,
      opening_amount: first.opening_amount,
      in_qty: rows.reduce((s, r) => s + r.in_qty, 0),
      in_amount: rows.reduce((s, r) => s + r.in_amount, 0),
      out_qty: rows.reduce((s, r) => s + r.out_qty, 0),
      out_amount: rows.reduce((s, r) => s + r.out_amount, 0),
      ending_qty: last.ending_qty,
      ending_amount: last.ending_amount
    })
    return rows
  }

  return { monthlyStockSummary }
}
