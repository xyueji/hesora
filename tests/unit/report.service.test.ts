import { expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'

it('reports completed dated activity, historical cost and signed stocktake quantities', () => {
  const db = openMemDb()
  const reports = createReportService(db)
  db.exec(`
    INSERT INTO warehouse (id, code, name) VALUES (1, 'W', '主仓');
    INSERT INTO product (id, code, name, base_unit) VALUES (1, 'P', '商品', '件');
    INSERT INTO customer (id, code, name) VALUES (1, 'C', '客户');
    INSERT INTO fund_account (id, code, name, type) VALUES (1, 'F', '现金', 'cash');
  `)
  const date = '2026-11-07'
  const item = { product_id: 1, qty: 10, price: 2 }
  const purchase = createPurchaseService(db)
  purchase.create({ date, warehouse_id: 1, items: [item] })
  createSaleService(db).create({ date, warehouse_id: 1, items: [{ ...item, qty: 3, price: 5 }] })
  createStocktakeService(db).create({ date, warehouse_id: 1, items: [{ product_id: 1, actual_qty: 5 }] })
  createPaymentService(db).createReceipt({ date, account_id: 1, partner_id: 1, amount: 5 })
  purchase.create({ date: '2026-11-08', warehouse_id: 1, items: [{ ...item, price: 8 }] })
  db.exec("INSERT INTO doc (no, type, date, total_amount, status) VALUES ('draft', 'sale', '2026-11-07', 99, 'draft')")
  const period = { date_from: date, date_to: date }
  expect(reports.query({ ...period, kind: 'sales' }).rows).toEqual([expect.objectContaining({ count: 1, amount: 15 })])
  expect(reports.query({ ...period, kind: 'purchases' }).rows).toEqual([expect.objectContaining({ count: 1, amount: 20 })])
  expect(reports.query({ ...period, kind: 'profit' }).rows).toEqual([expect.objectContaining({ cost: 6, profit: 9 })])
  expect(reports.query({ ...period, kind: 'hot' }).rows).toEqual([expect.objectContaining({ code: 'P', qty: 3, amount: 15 })])
  expect(reports.query({ ...period, kind: 'fund' }).rows).toEqual([expect.objectContaining({ account: '现金', income: 5, expense: 0 })])
  expect(reports.query({ ...period, kind: 'stocktake' }).rows).toEqual([expect.objectContaining({ book_qty: 7, actual_qty: 5, diff: -2 })])
  expect(reports.query({ kind: 'purchases', page: 2, pageSize: 1 })).toMatchObject({ total: 2, rows: [{ date }] })
  expect(reports.query({ ...period, kind: 'sales', warehouse_id: 2 }).total).toBe(0)
  expect(reports.query({ ...period, kind: 'hot', keyword: 'P' }).total).toBe(1)
  expect(reports.query({ ...period, kind: 'hot', keyword: 'missing' }).total).toBe(0)
  expect(reports.query({ ...period, kind: 'fund', account_id: 1, direction: 'out' }).total).toBe(0)
  expect(reports.query({ ...period, kind: 'fund', account_id: 1, direction: 'in' }).totals).toEqual({ income: 5, expense: 0 })
  expect(reports.query({ ...period, kind: 'stockSheet', warehouse_id: 1, keyword: 'P' }).rows)
    .toEqual([expect.objectContaining({ code: 'P', warehouse: '主仓', book_qty: 15 })])
  const csv = reports.exportCsv({ kind: 'purchases', page: 2, pageSize: 1 })
  expect(csv).toContain('2026-11-08,1,80,0,80')
  expect(csv).toContain('2026-11-07,1,20,0,20')
  db.close()
})
