import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'

let db: Database
let arr: ReturnType<typeof createArrearsService>
let customerId: number
let supplierId: number
let accountId: number
let warehouseId: number
let productId: number

beforeEach(() => {
  db = openMemDb()
  arr = createArrearsService(db)
  customerId = createCustomerService(db).create({ code: 'C1', name: '张三', opening_receivable: 0 })
  supplierId = createSupplierService(db).create({ code: 'S1', name: '老王', opening_payable: 0 })
  accountId = createFundService(db).create({ name: '现金', type: 'cash' })
  warehouseId = Number(db.prepare("INSERT INTO warehouse (code, name) VALUES ('W1', '主仓')").run().lastInsertRowid)
  productId = Number(db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P1', '品', '件')").run().lastInsertRowid)
  createPurchaseService(db).create({ warehouse_id: warehouseId, items: [{ product_id: productId, qty: 10, price: 4 }] })
})
afterEach(() => db.close())

const recvBalance = () => arr.receivables().find((r) => r.partner_id === customerId)?.balance
const payBalance = () => arr.payables().find((r) => r.partner_id === supplierId)?.balance

describe('return affects arrears (return-arrears.test.ts)', () => {
  it('销售退货（挂账）后客户应收余额减少', () => {
    const sale = createSaleService(db)
    const s = sale.create({ customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 4, price: 10 }] })
    expect(recvBalance()).toBe(40)
    sale.createReturn({ source_doc_id: s.id, customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 1, price: 10 }] })
    expect(recvBalance()).toBe(30)
  })

  it('销售退货（实退现金）后客户应收余额同样减少', () => {
    const sale = createSaleService(db)
    const s = sale.create({ customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 4, price: 10 }] })
    // 先全额收款再实退：余额应 = 40 − 40（收款）− 10（退货冲减）+ 10（现金退款）= 0
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 40, allocations: [{ doc_id: s.id, amount: 40 }] })
    expect(recvBalance()).toBe(0)
    sale.createReturn({ source_doc_id: s.id, customer_id: customerId, warehouse_id: warehouseId, account_id: accountId, items: [{ product_id: productId, qty: 1, price: 10 }] })
    expect(recvBalance()).toBe(0)
  })

  it('采购退货（挂账）后供应商应付余额减少', () => {
    const purchase = createPurchaseService(db)
    const p = purchase.create({ supplier_id: supplierId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 2, price: 5 }] })
    expect(payBalance()).toBe(10)
    purchase.createReturn({ source_doc_id: p.id, supplier_id: supplierId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 1, price: 5 }] })
    expect(payBalance()).toBe(5)
  })

  it('采购退货（实退现金）后供应商应付余额同样减少', () => {
    const purchase = createPurchaseService(db)
    const p = purchase.create({ supplier_id: supplierId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 2, price: 5 }] })
    createPaymentService(db).createPayment({ partner_id: supplierId, account_id: accountId, amount: 10, allocations: [{ doc_id: p.id, amount: 10 }] })
    expect(payBalance()).toBe(0)
    purchase.createReturn({ source_doc_id: p.id, supplier_id: supplierId, warehouse_id: warehouseId, account_id: accountId, items: [{ product_id: productId, qty: 1, price: 5 }] })
    expect(payBalance()).toBe(0)
  })

  it('退货产生的 fund_flow 行带 partner_id（客户）', () => {
    const sale = createSaleService(db)
    const s = sale.create({ customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 4, price: 10 }] })
    sale.createReturn({ source_doc_id: s.id, customer_id: customerId, warehouse_id: warehouseId, account_id: accountId, items: [{ product_id: productId, qty: 1, price: 10 }] })
    const flow = db.prepare("SELECT partner_id FROM fund_flow WHERE doc_type = 'sale_return'").get() as { partner_id: number | null }
    expect(flow?.partner_id).toBe(customerId)
  })

  it('退货产生的 fund_flow 行带 partner_id（供应商）', () => {
    const purchase = createPurchaseService(db)
    const p = purchase.create({ supplier_id: supplierId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 2, price: 5 }] })
    purchase.createReturn({ source_doc_id: p.id, supplier_id: supplierId, warehouse_id: warehouseId, account_id: accountId, items: [{ product_id: productId, qty: 1, price: 5 }] })
    const flow = db.prepare("SELECT partner_id FROM fund_flow WHERE doc_type = 'purchase_return'").get() as { partner_id: number | null }
    expect(flow?.partner_id).toBe(supplierId)
  })

  it('部分收款核销后再退货：余额按 冲减应收 正确递减', () => {
    const sale = createSaleService(db)
    const s = sale.create({ customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 4, price: 10 }] })
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 25, allocations: [{ doc_id: s.id, amount: 25 }] })
    expect(recvBalance()).toBe(15)
    sale.createReturn({ source_doc_id: s.id, customer_id: customerId, warehouse_id: warehouseId, items: [{ product_id: productId, qty: 1, price: 10 }] })
    expect(recvBalance()).toBe(5)
  })
})
