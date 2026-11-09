import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createStatementService } from '../../src/main/services/stats/statement.service'
import { BizError } from '../../src/shared/result'
import type { DB } from '../../src/main/services/doc/doc.service'

// 让利闭环 #3：收款核销优惠（payment_allocation.preferential）。
// 口径：核销金额 + 优惠金额 = 本次销账金额；未核销余额 = total_amount − Σamount − Σpreferential。
describe('payment 优惠核销（write_off）', () => {
  let db: DB
  let ctx: {
    customerId: number
    accountId: number
    warehouseId: number
    productId: number
    saleId: number
  }

  beforeEach(() => {
    db = openMemDb() as DB
    const fund = createFundService(db)
    const accountId = fund.create({ name: '现金', type: 'cash' })
    const customerId = createCustomerService(db).create({ code: 'C001', name: '客户甲', opening_receivable: 0 })
    const supplierId = createSupplierService(db).create({ code: 'S001', name: '供应商乙', opening_payable: 0 })
    const warehouseId = Number(
      db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
    )
    const productId = Number(
      db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
    )
    db.prepare("INSERT INTO inventory (warehouse_id, product_id, qty, moving_cost) VALUES (?, ?, 1000, 1)")
      .run(warehouseId, productId)
    const sale = createSaleService(db).create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      preferential_amount: 5,
      items: [{ product_id: productId, qty: 2, price: 50 }]
    })
    ctx = { customerId, accountId, warehouseId, productId, saleId: sale.id }
    void supplierId
  })

  it('部分优惠核销：amount 95 + preferential 5 清账 100 的单（原单已含整单优惠）', () => {
    const payment = createPaymentService(db)
    // 应收 95（total_amount 已扣整单优惠 5）
    const receipt = payment.createReceipt({
      partner_id: ctx.customerId,
      account_id: ctx.accountId,
      amount: 90,
      allocations: [{ doc_id: ctx.saleId, amount: 90, preferential: 5 }]
    })
    const detail = payment.getReceiptDetail(receipt.id)
    const alloc = detail?.allocations[0]
    expect(alloc?.doc_id).toBe(ctx.saleId)
    expect(alloc?.amount).toBe(90)
    expect(alloc?.preferential).toBe(5)
    // 全部核销完毕
    expect(payment.openDocuments('receipt', ctx.customerId)).toHaveLength(0)
    // 往来余额 = 0
    const arrears = createArrearsService(db)
    expect(arrears.receivables().find((r) => r.partner_id === ctx.customerId)?.balance).toBe(0)
  })

  it('部分优惠核销：余额 = total − Σamount − Σpreferential', () => {
    const payment = createPaymentService(db)
    payment.createReceipt({
      partner_id: ctx.customerId,
      account_id: ctx.accountId,
      amount: 50,
      allocations: [{ doc_id: ctx.saleId, amount: 50, preferential: 10 }]
    })
    const open = payment.openDocuments('receipt', ctx.customerId).find((o) => o.id === ctx.saleId)
    expect(open?.remaining).toBe(35) // 95 − 50 − 10
  })

  it('超额拒绝：amount + preferential > 未核销余额', () => {
    const payment = createPaymentService(db)
    expect(() =>
      payment.createReceipt({
        partner_id: ctx.customerId,
        account_id: ctx.accountId,
        amount: 91,
        allocations: [{ doc_id: ctx.saleId, amount: 91, preferential: 5 }]
      })
    ).toThrowError(BizError)
  })

  it('statement.queryLines / aging 未核销口径含 preferential', () => {
    const payment = createPaymentService(db)
    payment.createReceipt({
      partner_id: ctx.customerId,
      account_id: ctx.accountId,
      amount: 50,
      allocations: [{ doc_id: ctx.saleId, amount: 50, preferential: 10 }]
    })
    const statement = createStatementService(db)
    const st = statement.statement({ partner_type: 'customer', partner_id: ctx.customerId })
    const saleLine = st.lines.find((l) => l.doc_id === ctx.saleId)
    expect(saleLine?.allocated).toBe(60) // 50 + 10
    const aging = statement.aging({ partner_type: 'customer', as_of: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) })
    const row = aging.rows.find((r) => r.partner_id === ctx.customerId)
    expect(row?.balance).toBe(35) // 95 − 60，未核销口径含优惠
  })

  it('arrears.receivables 优惠核销计入 settled 口径（balance 减让利）', () => {
    const payment = createPaymentService(db)
    payment.createReceipt({
      partner_id: ctx.customerId,
      account_id: ctx.accountId,
      amount: 50,
      allocations: [{ doc_id: ctx.saleId, amount: 50, preferential: 10 }]
    })
    const arrears = createArrearsService(db)
    const row = arrears.receivables().find((r) => r.partner_id === ctx.customerId)
    expect(row?.balance).toBe(35)
  })
})
