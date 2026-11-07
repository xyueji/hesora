import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import type { ArrearsRow } from '../../src/shared/types/stats'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'

let db: Database
let svc: ReturnType<typeof createArrearsService>

beforeEach(() => {
  db = openMemDb()
  svc = createArrearsService(db)
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

function doSale(customerId: number, warehouseId: number, productId: number, price: number): void {
  // 先进货建立库存（销售出库要求库存充足）
  doPurchase(undefined, warehouseId, productId, price / 2)
  createSaleService(db).create({
    customer_id: customerId,
    warehouse_id: warehouseId,
    items: [{ product_id: productId, qty: 1, price }]
  })
}

function doPurchase(supplierId: number | undefined, warehouseId: number, productId: number, price: number): void {
  createPurchaseService(db).create({
    supplier_id: supplierId,
    warehouse_id: warehouseId,
    items: [{ product_id: productId, qty: 1, price }]
  })
}

describe('arrears.service', () => {
  it('receivables: opening + sales - received', () => {
    const { customerId, accountId, warehouseId, productId } = setupBase()
    doSale(customerId, warehouseId, productId, 500)
    const payment = createPaymentService(db)
    payment.createReceipt({ partner_id: customerId, account_id: accountId, amount: 300 })
    const rows = svc.receivables()
    const row = rows.find((r) => r.partner_id === customerId)
    expect(row).toEqual({
      partner_id: customerId,
      partner_name: '客户甲',
      opening: 100,
      amount: 500,
      settled: 300,
      balance: 300
    })
  })

  it('receivables: fully paid retail does not reduce prior debt', () => {
    const { customerId, accountId, warehouseId, productId } = setupBase()
    // 零售单带客户与结算账户 → fund_flow doc_type='retail', direction='in'
    db.transaction(() => {
      const docId = Number(
        db
          .prepare(
            "INSERT INTO doc (type, no, date, partner_id, account_id, total_amount) VALUES ('retail', 'LS001', '2026-01-01', ?, ?, 80)"
          )
          .run(customerId, accountId).lastInsertRowid
      )
      db.prepare(
        "INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date) VALUES (?, 'retail', ?, 80, 'in', '2026-01-01')"
      ).run(accountId, docId)
    })()
    void warehouseId
    void productId
    const rows = svc.receivables()
    const row = rows.find((r) => r.partner_id === customerId)
    expect(row?.settled).toBe(80)
    expect(row?.amount).toBe(80)
    expect(row?.balance).toBe(100)
  })

  it('reduces the net receivable only for returns credited to the customer account', () => {
    const { customerId, accountId, warehouseId, productId } = setupBase()
    doSale(customerId, warehouseId, productId, 50)
    const sale = createSaleService(db)
    const input = {
      customer_id: customerId,
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 1, price: 10 }]
    }
    sale.createReturn(input)
    sale.createReturn({ ...input, account_id: accountId })
    expect(svc.receivables()[0]).toMatchObject({ amount: 30, settled: -10, balance: 140 })
  })

  it('reduces the net payable only for returns credited by the supplier', () => {
    const { supplierId, accountId, warehouseId, productId } = setupBase()
    const purchase = createPurchaseService(db)
    purchase.create({
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 2, price: 20 }]
    })
    const input = {
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 1, price: 20 }]
    }
    purchase.createReturn(input)
    purchase.createReturn({ ...input, account_id: accountId })
    expect(svc.payables()[0]).toMatchObject({ amount: 0, settled: -20, balance: 70 })
  })

  it('payables: opening + purchases - paid', () => {
    const { supplierId, accountId, warehouseId, productId } = setupBase()
    doPurchase(supplierId, warehouseId, productId, 200)
    createPaymentService(db).createPayment({
      partner_id: supplierId,
      account_id: accountId,
      amount: 120
    })
    const rows = svc.payables()
    const row = rows.find((r) => r.partner_id === supplierId)
    expect(row).toEqual({
      partner_id: supplierId,
      partner_name: '供应商乙',
      opening: 50,
      amount: 200,
      settled: 120,
      balance: 130
    })
  })

  it('summary sums balances', () => {
    const { customerId, supplierId, accountId, warehouseId, productId } = setupBase()
    doSale(customerId, warehouseId, productId, 500)
    doPurchase(supplierId, warehouseId, productId, 200)
    const payment = createPaymentService(db)
    payment.createReceipt({ partner_id: customerId, account_id: accountId, amount: 300 })
    payment.createPayment({ partner_id: supplierId, account_id: accountId, amount: 120 })
    expect(svc.summary()).toEqual({ total_receivable: 300, total_payable: 130 })
  })

  it('customer with no activity appears with opening only', () => {
    setupBase()
    const rows = svc.receivables()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      partner_id: 1,
      partner_name: '客户甲',
      opening: 100,
      amount: 0,
      settled: 0,
      balance: 100
    })
  })

  it('rows ordered by balance desc', () => {
    const base = setupBase()
    const customer = createCustomerService(db)
    const c2 = customer.create({ code: 'C002', name: '客户乙', opening_receivable: 900 })
    doSale(base.customerId, base.warehouseId, base.productId, 1000)
    const rows = svc.receivables()
    expect(rows.length).toBe(2)
    const [first, second] = rows as [ArrearsRow, ArrearsRow]
    expect(first.partner_id).toBe(base.customerId)
    expect(second.partner_id).toBe(c2)
    expect(second.balance).toBe(900)
  })
})
