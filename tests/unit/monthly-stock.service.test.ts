import { describe, expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createMonthlyService } from '../../src/main/services/stats/monthly.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'

function seed(db: Parameters<typeof createMonthlyService>[0]): void {
  db.exec(`
    INSERT INTO warehouse (id, code, name) VALUES (1, 'W1', '主仓');
    INSERT INTO warehouse (id, code, name) VALUES (2, 'W2', '次仓');
    INSERT INTO product (id, code, name, base_unit) VALUES (1, 'P', '商品', '件');
    INSERT INTO customer (id, code, name) VALUES (1, 'C', '客户');
  `)
}

describe('monthlyStockSummary', () => {
  it('rolls opening forward across months: ending = opening + in - out, amounts match cost_log', () => {
    const db = openMemDb()
    seed(db)
    const purchases = createPurchaseService(db)
    const sales = createSaleService(db)
    // 1月：入 10 @2 → 期初 0/0，入 10/20，出 0/0，期末 10/20
    purchases.create({ date: '2026-01-10', warehouse_id: 1, items: [{ product_id: 1, qty: 10, price: 2 }] })
    // 2月：出 4（移动加权成本 2）→ 期初 10/20，出 4/8，期末 6/12
    sales.create({ date: '2026-02-05', warehouse_id: 1, items: [{ product_id: 1, qty: 4, price: 5 }] })
    // 3月：入 10 @5（移动加权 (6*2+10*5)/16=3.875），出 6 → 出金额 6*3.875=23.25 → 期末 10/25
    purchases.create({ date: '2026-03-01', warehouse_id: 1, items: [{ product_id: 1, qty: 10, price: 5 }] })
    sales.create({ date: '2026-03-20', warehouse_id: 1, items: [{ product_id: 1, qty: 6, price: 8 }] })

    const rows = createMonthlyService(db).monthlyStockSummary({ year: 2026 })
    expect(rows).toHaveLength(13)
    const m1 = rows[0]
    expect(m1).toMatchObject({ month: 1, opening_qty: 0, opening_amount: 0, in_qty: 10, in_amount: 20, out_qty: 0, out_amount: 0, ending_qty: 10, ending_amount: 20 })
    const m2 = rows[1]
    expect(m2).toMatchObject({ month: 2, opening_qty: 10, opening_amount: 20, out_qty: 4, out_amount: 8, ending_qty: 6, ending_amount: 12 })
    const m3 = rows.find((r) => r.month === 3)!
    expect(m3).toMatchObject({ month: 3, opening_qty: 6, opening_amount: 12, in_qty: 10, in_amount: 50, out_qty: 6, out_amount: 23.25, ending_qty: 10, ending_amount: 38.75 })
    // 无变动月承前
    expect(rows[3]).toMatchObject({ month: 4, opening_qty: 10, ending_qty: 10, in_qty: 0, out_qty: 0 })
    expect(rows[11]).toMatchObject({ month: 12, ending_qty: 10, ending_amount: 38.75 })
    // 合计行
    expect(rows.find((r) => r.month === 0)).toMatchObject({ in_qty: 20, in_amount: 70, out_qty: 10, out_amount: 31.25, ending_qty: 10, ending_amount: 38.75 })
    // 金额口径与 cost_log 成本变动一致：3月出库金额 = 3月内 Σ(-change_qty*unit_cost)
    const costs = db.prepare("SELECT COALESCE(SUM(CASE WHEN change_qty < 0 THEN -change_qty * unit_cost ELSE 0 END),0) AS out_amount FROM cost_log WHERE product_id = 1 AND warehouse_id = 1 AND source IN (SELECT type FROM doc WHERE date >= '2026-03-01' AND date < '2026-04-01' AND id = cost_log.source_id)").get() as { out_amount: number }
    expect(Number(m3.out_amount.toFixed(2))).toBe(Number(costs.out_amount.toFixed(2)))
    db.close()
  })

  it('filters by warehouse and product; doc-level warehouse fallback', () => {
    const db = openMemDb()
    seed(db)
    const purchases = createPurchaseService(db)
    purchases.create({ date: '2026-05-10', warehouse_id: 1, items: [{ product_id: 1, qty: 10, price: 3 }] })
    purchases.create({ date: '2026-06-10', warehouse_id: 2, items: [{ product_id: 1, qty: 4, price: 3 }] })

    const svc = createMonthlyService(db)
    const w1 = svc.monthlyStockSummary({ year: 2026, warehouse_id: 1 })
    expect(w1.find((r) => r.month === 5)).toMatchObject({ in_qty: 10, in_amount: 30, ending_qty: 10 })
    expect(w1.find((r) => r.month === 6)).toMatchObject({ in_qty: 0, ending_qty: 10 })
    const w2 = svc.monthlyStockSummary({ year: 2026, warehouse_id: 2 })
    expect(w2.find((r) => r.month === 6)).toMatchObject({ in_qty: 4, ending_qty: 4 })
    const all = svc.monthlyStockSummary({ year: 2026 })
    expect(all.find((r) => r.month === 0)).toMatchObject({ in_qty: 14, in_amount: 42, ending_qty: 14, ending_amount: 42 })
    db.close()
  })

  it('empty year returns carry-zero rows and total', () => {
    const db = openMemDb()
    seed(db)
    const rows = createMonthlyService(db).monthlyStockSummary({ year: 2030 })
    expect(rows).toHaveLength(13)
    expect(rows.every((r) => r.opening_qty === 0 && r.ending_qty === 0)).toBe(true)
    expect(rows.find((r) => r.month === 0)).toMatchObject({ opening_qty: 0, ending_qty: 0 })
    db.close()
  })

  it('validates year', () => {
    const db = openMemDb()
    expect(() => createMonthlyService(db).monthlyStockSummary({ year: NaN })).toThrow()
    expect(() => createMonthlyService(db).monthlyStockSummary({ year: 20 })).toThrow()
    db.close()
  })

  it('matches the cost-change detail report caliber (Σ ±change_qty*unit_cost)', () => {
    const db = openMemDb()
    seed(db)
    const purchases = createPurchaseService(db)
    const sales = createSaleService(db)
    purchases.create({ date: '2026-01-05', warehouse_id: 1, items: [{ product_id: 1, qty: 10, price: 2 }] })
    purchases.create({ date: '2026-01-15', warehouse_id: 1, items: [{ product_id: 1, qty: 5, price: 4 }] })
    sales.create({ date: '2026-02-01', warehouse_id: 1, items: [{ product_id: 1, qty: 6, price: 9 }] })
    // 累计入金额（cost_log 口径）
    const inSum = Number((db.prepare("SELECT COALESCE(SUM(change_qty * unit_cost),0) AS s FROM cost_log WHERE change_qty > 0").get() as { s: number }).s)
    const outSum = Number((db.prepare("SELECT COALESCE(SUM(-change_qty * unit_cost),0) AS s FROM cost_log WHERE change_qty < 0").get() as { s: number }).s)
    const rows = createMonthlyService(db).monthlyStockSummary({ year: 2026 })
    const total = rows.find((r) => r.month === 0)
    expect(total?.in_amount).toBeCloseTo(inSum, 6)
    expect(total?.out_amount).toBeCloseTo(outSum, 6)
    // 期末金额 = 累计入金额 - 累计出金额（与 report.service profit 口径一致）
    expect(total?.ending_amount).toBeCloseTo(inSum - outSum, 6)
    db.close()
  })
})
