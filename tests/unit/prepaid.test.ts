import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'

// P1 功能 #2：预存款/订金管理。
// 收款单 charge_type='prepaid'：金额计入 partner.prepaid，不写核销；
// 销售/零售单 prepaid_amount：从客户预存款抵扣（fund_flow 'in' + doc.prepaid_amount），
// 不足报 PREPAID_INSUFFICIENT；散客不可用。
describe('prepaid（预存款）', () => {
  let db: Database
  let customerId: number
  let supplierId: number
  let accountId: number
  let warehouseId: number
  let productId: number

  beforeEach(() => {
    db = openMemDb()
    customerId = createCustomerService(db).create({ code: 'C001', name: '客户甲', opening_receivable: 0 })
    supplierId = createSupplierService(db).create({ code: 'S001', name: '供应商乙', opening_payable: 0 })
    accountId = createFundService(db).create({ name: '现金', type: 'cash' })
    warehouseId = Number(
      db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
    )
    productId = Number(
      db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
    )
    db.prepare("INSERT INTO inventory (warehouse_id, product_id, qty, moving_cost) VALUES (?, ?, 1000, 1)")
      .run(warehouseId, productId)
  })

  const prepaidOf = (id: number, table = 'customer'): number =>
    Number(db.prepare(`SELECT prepaid FROM ${table} WHERE id = ?`).pluck().get(id))

  it('收款单 charge_type=prepaid → partner.prepaid 增加 + fund_flow 记账，不写核销', () => {
    const pay = createPaymentService(db)
    const doc = pay.createReceipt({ partner_id: customerId, account_id: accountId, amount: 500, date: '2026-11-01', charge_type: 'prepaid' })
    expect(prepaidOf(customerId)).toBe(500)
    // fund_flow 记账
    const flow = db.prepare('SELECT amount, direction FROM fund_flow WHERE doc_id = ? AND doc_type = ?').get(doc.id, 'receipt') as
      { amount: number; direction: string }
    expect(flow.amount).toBe(500)
    expect(flow.direction).toBe('in')
    // 无核销行
    expect(db.prepare('SELECT COUNT(*) c FROM payment_allocation WHERE payment_id = ?').pluck().get(doc.id)).toBe(0)
    // doc.charge_type 落库
    expect(db.prepare('SELECT charge_type FROM doc WHERE id = ?').pluck().get(doc.id)).toBe('prepaid')
  })

  it('付款单 charge_type=prepaid → supplier.prepaid 增加', () => {
    createPaymentService(db).createPayment({ partner_id: supplierId, account_id: accountId, amount: 300, date: '2026-11-01', charge_type: 'prepaid' })
    expect(prepaidOf(supplierId, 'supplier')).toBe(300)
  })

  it('normal 收款单不影响预存款（回归）', () => {
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 200, date: '2026-11-01' })
    expect(prepaidOf(customerId)).toBe(0)
  })

  it('销售单用预存款抵扣 → prepaid 扣减 + fund_flow + 无核销行（未付部分仍挂应收）', () => {
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 500, date: '2026-11-01', charge_type: 'prepaid' })
    const doc = createSaleService(db).create({
      customer_id: customerId, warehouse_id: warehouseId, date: '2026-11-02',
      prepaid_amount: 200,
      items: [{ product_id: productId, qty: 1, price: 300 }]
    })
    expect(prepaidOf(customerId)).toBe(300)
    // doc.prepaid_amount 落库
    expect(db.prepare('SELECT prepaid_amount FROM doc WHERE id = ?').pluck().get(doc.id)).toBe(200)
    // fund_flow 出账（预存款抵扣 = 钱已收过）
    const flow = db.prepare("SELECT amount, direction FROM fund_flow WHERE doc_id = ? AND doc_type = 'sale' AND partner_id = ?")
      .get(doc.id, customerId) as { amount: number; direction: string } | undefined
    expect(flow).toBeDefined()
    expect(flow!.amount).toBe(200)
    expect(flow!.direction).toBe('in')
  })

  it('预存款不足报 PREPAID_INSUFFICIENT', () => {
    createPaymentService(db).createReceipt({ partner_id: customerId, account_id: accountId, amount: 100, date: '2026-11-01', charge_type: 'prepaid' })
    expect(() => createSaleService(db).create({
      customer_id: customerId, warehouse_id: warehouseId, date: '2026-11-02',
      prepaid_amount: 200,
      items: [{ product_id: productId, qty: 1, price: 300 }]
    })).toThrowError(/预存款不足/)
  })

  it('散客（无 partner）不可用预存款', () => {
    expect(() => createSaleService(db).create({
      warehouse_id: warehouseId, date: '2026-11-02',
      prepaid_amount: 50,
      items: [{ product_id: productId, qty: 1, price: 100 }]
    })).toThrowError(/散客|预存款/)
  })

  it('收款计预存款 → 销售抵扣 → 退款扣减预存款（不足报错）', () => {
    const pay = createPaymentService(db)
    pay.createReceipt({ partner_id: customerId, account_id: accountId, amount: 400, date: '2026-11-01', charge_type: 'prepaid' })
    createSaleService(db).create({
      customer_id: customerId, warehouse_id: warehouseId, date: '2026-11-02',
      prepaid_amount: 100,
      items: [{ product_id: productId, qty: 1, price: 200 }]
    })
    expect(prepaidOf(customerId)).toBe(300)
    // 退款单：反向 charge_type=prepaid 收款单（客户取回预存款）
    pay.createReceipt({ partner_id: customerId, account_id: accountId, amount: 200, date: '2026-11-03', charge_type: 'prepaid_refund' })
    expect(prepaidOf(customerId)).toBe(100)
    // 再退 200 超出余额
    expect(() => pay.createReceipt({ partner_id: customerId, account_id: accountId, amount: 200, date: '2026-11-04', charge_type: 'prepaid_refund' }))
      .toThrowError(/预存款不足/)
  })
})
