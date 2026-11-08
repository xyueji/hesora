import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import type { AgingRow } from '../../src/shared/types/stats'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'

// P2-2 账龄报表：未结余额按单据日期分档（0-30/31-60/61-90/90+），
// 核销按 FIFO 归属到最早的单据；期初余额视作 90+ 档。
describe('arrears aging', () => {
  let db: Database
  let svc: ReturnType<typeof createArrearsService>

  beforeEach(() => {
    db = openMemDb()
    svc = createArrearsService(db)
  })

  function setup(): { customerId: number; supplierId: number; accountId: number; warehouseId: number; productId: number } {
    const customer = createCustomerService(db)
    const supplier = createSupplierService(db)
    const fund = createFundService(db)
    const customerId = customer.create({ code: 'C001', name: '客户甲', opening_receivable: 100 })
    const supplierId = supplier.create({ code: 'S001', name: '供应商乙', opening_payable: 0 })
    const accountId = fund.create({ name: '现金', type: 'cash' })
    const warehouseId = Number(
      db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
    )
    const productId = Number(
      db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
    )
    // 预置足量库存，销售出库不依赖入库顺序
    db.prepare("INSERT INTO inventory (warehouse_id, product_id, qty, moving_cost) VALUES (?, ?, 1000, 1)")
      .run(warehouseId, productId)
    return { customerId, supplierId, accountId, warehouseId, productId }
  }

  function doSale(customerId: number, warehouseId: number, productId: number, price: number, date?: string): void {
    createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      ...(date ? { date } : {}),
      items: [{ product_id: productId, qty: 1, price }]
    })
  }

  const find = (rows: AgingRow[], id: number): AgingRow => {
    const row = rows.find((r) => r.partner_id === id)
    expect(row).toBeDefined()
    return row!
  }

  it('buckets unsettled sales by document age and puts opening into 90+', () => {
    const { customerId, warehouseId, productId } = setup()
    doSale(customerId, warehouseId, productId, 200, '2026-09-01') // ~68 天前 → 61-90
    doSale(customerId, warehouseId, productId, 300, '2026-10-25') // ~14 天前 → 0-30
    doSale(customerId, warehouseId, productId, 400, '2026-09-20') // ~49 天前 → 31-60
    doSale(customerId, warehouseId, productId, 500, '2026-07-01') // ~130 天前 → 90+
    const result = svc.aging('2026-11-08')
    const row = find(result.customers, customerId)
    expect(row).toEqual({
      partner_id: customerId, partner_name: '客户甲',
      total: 1500, b0_30: 300, b31_60: 400, b61_90: 200, b90plus: 600, // 90+ 含期初 100
      oldest: '2026-07-01'
    })
  })

  it('FIFO: receipt settles the oldest sale first', () => {
    const { customerId, accountId, warehouseId, productId } = setup()
    doSale(customerId, warehouseId, productId, 200, '2026-09-01')
    doSale(customerId, warehouseId, productId, 300, '2026-10-25')
    createPaymentService(db).createReceipt({
      partner_id: customerId, account_id: accountId, amount: 250,
      allocations: [
        { doc_id: db.prepare("SELECT id FROM doc WHERE date='2026-09-01' AND type='sale'").pluck().get() as number, amount: 200 },
        { doc_id: db.prepare("SELECT id FROM doc WHERE date='2026-10-25' AND type='sale'").pluck().get() as number, amount: 50 }
      ]
    })
    const result = svc.aging('2026-11-08')
    const row = find(result.customers, customerId)
    expect(row.total).toBe(300 - 50 + 100) // 未结部分 + 期初
    expect(row.b0_30).toBe(250)
    expect(row.b61_90).toBe(0)
    expect(row.b90plus).toBe(100)
  })

  it('asOf cutoff: later sales excluded, later receipts excluded', () => {
    const { customerId, accountId, warehouseId, productId } = setup()
    doSale(customerId, warehouseId, productId, 100, '2026-10-01')
    doSale(customerId, warehouseId, productId, 999, '2026-11-07') // asOf 之后
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 40, date: '2026-11-07' })
    const result = svc.aging('2026-10-31')
    const row = find(result.customers, customerId)
    // 期初 100 归 90+，10-01 的销售 100 未结归 0-30；asOf 之后的销售/收款不计
    expect(row.total).toBe(200)
    expect(row.b0_30).toBe(100)
    expect(row.b90plus).toBe(100)
  })

  it('supplier payables age the same way', () => {
    const { supplierId, warehouseId, productId } = setup()
    createPurchaseService(db).create({
      supplier_id: supplierId, warehouse_id: warehouseId,
      date: '2026-08-01', // ~99 天前 → 90+
      items: [{ product_id: productId, qty: 1, price: 500 }]
    })
    const result = svc.aging('2026-11-08')
    const row = find(result.suppliers, supplierId)
    expect(row.total).toBe(500)
    expect(row.b90plus).toBe(500)
  })

  it('aging rows serialize to CSV via buildCsv (export contract)', () => {
    const { customerId, warehouseId, productId } = setup()
    createSaleService(db).create({
      customer_id: customerId, warehouse_id: warehouseId,
      date: '2026-11-01',
      items: [{ product_id: productId, qty: 1, price: 300 }]
    })
    const result = svc.aging('2026-11-08')
    const rows = result.customers
    expect(rows.length).toBeGreaterThan(0)
    // 导出契约：AgingView/case 'aging' 的 buildCsv 输入取自同一批字段
    expect(() =>
      rows.map((r) => [r.partner_name, r.total.toFixed(2), r.b0_30.toFixed(2), r.b31_60.toFixed(2), r.b61_90.toFixed(2), r.b90plus.toFixed(2), r.oldest ?? ''])
    ).not.toThrow()
  })
})
