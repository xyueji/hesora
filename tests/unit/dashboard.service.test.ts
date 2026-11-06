import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createDashboardService } from '../../src/main/services/stats/dashboard.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'

let db: Database
let svc: ReturnType<typeof createDashboardService>
const TODAY = '2026-03-10'

beforeEach(() => {
  db = openMemDb()
  svc = createDashboardService(db)
})

function setupBase(): { customerId: number; supplierId: number; accountId: number; warehouseId: number; productId: number } {
  const customer = createCustomerService(db)
  const supplier = createSupplierService(db)
  const fund = createFundService(db)
  const customerId = customer.create({ code: 'C001', name: '客户甲', opening_receivable: 100 })
  const supplierId = supplier.create({ code: 'S001', name: '供应商乙', opening_payable: 50 })
  const accountId = fund.create({ name: '现金', type: 'cash' })
  const warehouseId = Number(
    db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
  )
  const productId = Number(
    db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
  )
  return { customerId, supplierId, accountId, warehouseId, productId }
}

describe('dashboard.service', () => {
  it('summary: sale profit = item amount - qty*rate*moving_cost of matching inventory row', () => {
    const { customerId, supplierId, warehouseId, productId } = setupBase()
    // 进货 10@2（移动加权成本 2），今日销售 10@3 → 毛利 10*(3-2)=10
    createPurchaseService(db).create({
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      date: '2026-03-09',
      items: [{ product_id: productId, qty: 10, price: 2 }]
    })
    createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      date: TODAY,
      items: [{ product_id: productId, qty: 10, price: 3 }]
    })
    const s = svc.summary(TODAY)
    expect(s.sales_amount).toBe(30)
    expect(s.sales_count).toBe(1)
    expect(s.gross_profit).toBe(10)
  })

  it('summary: retail_amount counts retail docs of the date; stock_amount sums inventory qty*moving_cost', () => {
    const { warehouseId, accountId, productId } = setupBase()
    createPurchaseService(db).create({
      warehouse_id: warehouseId,
      date: '2026-03-08',
      items: [{ product_id: productId, qty: 5, price: 4 }]
    })
    createRetailService(db).create({
      warehouse_id: warehouseId,
      account_id: accountId,
      date: TODAY,
      items: [{ product_id: productId, qty: 2, price: 6 }]
    })
    const s = svc.summary(TODAY)
    expect(s.retail_amount).toBe(12)
    expect(s.sales_amount).toBe(0)
    expect(s.sales_count).toBe(0)
    // 剩余库存 3 * 移动加权成本 4 = 12
    expect(s.stock_amount).toBe(12)
  })

  it('summary: receipt/payment sums fund_flow by date and direction; totals_receivable/payable reuse arrears aggregates', () => {
    const { customerId, supplierId, accountId, warehouseId, productId } = setupBase()
    createPurchaseService(db).create({
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      date: '2026-03-09',
      items: [{ product_id: productId, qty: 4, price: 10 }]
    })
    createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      date: TODAY,
      items: [{ product_id: productId, qty: 2, price: 25 }]
    })
    const payment = createPaymentService(db)
    payment.createReceipt({ partner_id: customerId, account_id: accountId, amount: 30, date: TODAY })
    payment.createPayment({ partner_id: supplierId, account_id: accountId, amount: 20, date: TODAY })
    const s = svc.summary(TODAY)
    expect(s.receipt_amount).toBe(30)
    expect(s.payment_amount).toBe(20)
    // 应收 = 100 期初 + 50 销售 − 30 收款 = 120
    expect(s.total_receivable).toBe(120)
    // 应付 = 50 期初 + 40 进货 − 20 付款 = 70
    expect(s.total_payable).toBe(70)
  })

  it('summary: other-date docs excluded from today figures', () => {
    const { customerId, supplierId, warehouseId, productId } = setupBase()
    createPurchaseService(db).create({
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      date: '2026-03-01',
      items: [{ product_id: productId, qty: 1, price: 10 }]
    })
    createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      date: '2026-03-01',
      items: [{ product_id: productId, qty: 1, price: 999 }]
    })
    const s = svc.summary(TODAY)
    expect(s.sales_amount).toBe(0)
    expect(s.sales_count).toBe(0)
    expect(s.gross_profit).toBe(0)
  })

  it('trend: sums sale+retail per date, zero-fills missing days', () => {
    const { customerId, accountId, warehouseId, productId } = setupBase()
    createPurchaseService(db).create({
      warehouse_id: warehouseId,
      date: '2026-03-01',
      items: [{ product_id: productId, qty: 20, price: 1 }]
    })
    createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      date: '2026-03-08',
      items: [{ product_id: productId, qty: 2, price: 10 }]
    })
    createRetailService(db).create({
      warehouse_id: warehouseId,
      account_id: accountId,
      date: '2026-03-10',
      items: [{ product_id: productId, qty: 1, price: 7 }]
    })
    const rows = svc.trend(7, TODAY) // 2026-03-04 .. 2026-03-10
    expect(rows).toHaveLength(7)
    expect(rows[0]?.date).toBe('2026-03-04')
    expect(rows[rows.length - 1]?.date).toBe('2026-03-10')
    expect(rows.find((r) => r.date === '2026-03-08')?.amount).toBe(20)
    expect(rows.find((r) => r.date === '2026-03-10')?.amount).toBe(7)
    expect(rows.find((r) => r.date === '2026-03-04')?.amount).toBe(0)
    expect(rows.find((r) => r.date === '2026-03-09')?.amount).toBe(0)
  })

  it('trend: window of 1 day returns only that day', () => {
    const rows = svc.trend(1, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe(0)
  })
})
