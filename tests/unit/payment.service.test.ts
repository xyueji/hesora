import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { BizError } from '../../src/shared/result'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const fundService = createFundService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const paymentService = createPaymentService(db)
  const accountId = fundService.create({ name: '现金', type: 'cash', opening_balance: 0 })
  const customerId = customerService.create({ code: 'C001', name: '张三', opening_receivable: 0 })
  const supplierId = supplierService.create({ code: 'S001', name: '李四供货', opening_payable: 0 })
  return { db, paymentService, accountId, customerId, supplierId }
}

describe('payment.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('createReceipt: doc no SK, total=amount, fund_flow direction in', () => {
    const doc = ctx.paymentService.createReceipt({
      partner_id: ctx.customerId,
      account_id: ctx.accountId,
      amount: 123.5,
      remark: '货款'
    })
    expect(doc.no).toMatch(/^SK\d{8}\d{4}$/)
    expect(doc.total_amount).toBeCloseTo(123.5)
    expect(doc.type).toBe('receipt')
    const flow = ctx.db
      .prepare('SELECT * FROM fund_flow WHERE doc_id = ?')
      .get(doc.id) as { direction: string; amount: number; doc_type: string }
    expect(flow.direction).toBe('in')
    expect(flow.amount).toBeCloseTo(123.5)
    expect(flow.doc_type).toBe('receipt')
  })

  it('createPayment: doc no FK, fund_flow direction out', () => {
    const doc = ctx.paymentService.createPayment({
      partner_id: ctx.supplierId,
      account_id: ctx.accountId,
      amount: 88
    })
    expect(doc.no).toMatch(/^FK\d{8}\d{4}$/)
    const flow = ctx.db
      .prepare('SELECT * FROM fund_flow WHERE doc_id = ?')
      .get(doc.id) as { direction: string }
    expect(flow.direction).toBe('out')
  })

  it('amount <= 0 throws VALIDATION', () => {
    expect(() =>
      ctx.paymentService.createReceipt({ account_id: ctx.accountId, amount: 0 })
    ).toThrowError(/金额必须大于0/)
    expect(() =>
      ctx.paymentService.createPayment({ account_id: ctx.accountId, amount: -5 })
    ).toThrowError(BizError)
  })

  it('account not found throws NOT_FOUND 账户不存在', () => {
    expect(() =>
      ctx.paymentService.createReceipt({ account_id: 99999, amount: 10 })
    ).toThrowError(/账户不存在/)
  })

  it('getReceiptDetail returns doc + flow; wrong type throws NOT_FOUND', () => {
    const doc = ctx.paymentService.createReceipt({
      account_id: ctx.accountId,
      amount: 50
    })
    const d = ctx.paymentService.getReceiptDetail(doc.id)
    expect(d.doc.id).toBe(doc.id)
    expect(d.flow?.direction).toBe('in')
    expect(() => ctx.paymentService.getPaymentDetail(doc.id)).toThrowError(/付款单不存在/)
  })

  it('queryReceipt/queryPayment filter by type', () => {
    ctx.paymentService.createReceipt({ account_id: ctx.accountId, amount: 10 })
    ctx.paymentService.createPayment({ account_id: ctx.accountId, amount: 20 })
    expect(ctx.paymentService.queryReceipt({ page: 1, pageSize: 20 }).total).toBe(1)
    expect(ctx.paymentService.queryPayment({ page: 1, pageSize: 20 }).total).toBe(1)
    const page = ctx.paymentService.queryReceipt({ page: 1, pageSize: 20 })
    expect(page.items[0]!.type).toBe('receipt')
  })

  it('docService allows receipt with zero items but still rejects purchase', () => {
    const docService = createDocService(ctx.db)
    const doc = docService.create({
      type: 'receipt',
      account_id: ctx.accountId,
      items: []
    })
    expect(doc.type).toBe('receipt')
    expect(() =>
      docService.create({ type: 'purchase', warehouse_id: 1, items: [] })
    ).toThrowError(/明细不能为空/)
  })
})
