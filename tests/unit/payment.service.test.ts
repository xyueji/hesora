import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createPrintService } from '../../src/main/services/print/print.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { renderA4Html } from '../../src/shared/print/templates'
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

  it('keeps document lists within their domain even when a forged type is submitted', () => {
    createDocService(ctx.db).create({ type: 'purchase', items: [{ product_id: 1, qty: 2, price: 50 }] })
    expect(() => createSaleService(ctx.db).query({ type: 'purchase' as never, page: 1, pageSize: 20 })).toThrow(/类型/)
    expect(() => createPurchaseService(ctx.db).query({ type: 'receipt' as never, page: 1, pageSize: 20 })).toThrow(/类型/)
  })

  it('splits one receipt across accounts and reconciles only its allocated amount to the sale', () => {
    const sale = createDocService(ctx.db).create({ type: 'sale', partner_id: ctx.customerId, items: [{ product_id: 1, qty: 2, price: 50 }] })
    const bank = createFundService(ctx.db).create({ name: '对公账户', type: 'bank' })
    const receipt = ctx.paymentService.createReceipt({
      partner_id: ctx.customerId, amount: 60,
      accounts: [{ account_id: ctx.accountId, amount: 20 }, { account_id: bank, amount: 40 }],
      allocations: [{ doc_id: sale.id, amount: 55 }]
    })
    const detail = ctx.paymentService.getReceiptDetail(receipt.id)
    expect(detail.flows.map((row) => row.amount)).toEqual([20, 40])
    expect(detail.allocations).toEqual([{ doc_id: sale.id, no: sale.no, amount: 55 }])
    expect(ctx.paymentService.openDocuments('receipt', ctx.customerId)[0]).toMatchObject({ id: sale.id, remaining: 45 })
    expect(createArrearsService(ctx.db).receivables()[0]).toMatchObject({ settled: 60, balance: 40 })
    expect(() => ctx.paymentService.createReceipt({ partner_id: ctx.customerId, account_id: bank, amount: 46, allocations: [{ doc_id: sale.id, amount: 46 }] })).toThrow(/待核销/)
    expect(ctx.paymentService.queryReceipt({ page: 1, pageSize: 20 }).total).toBe(1)
  })

  it('prints a payment voucher with both account splits and the reconciled bill', () => {
    const order = createDocService(ctx.db).create({ type: 'purchase', partner_id: ctx.supplierId, items: [{ product_id: 1, qty: 2, price: 50 }] })
    const bank = createFundService(ctx.db).create({ name: '银行<核对>', type: 'bank' })
    const payment = ctx.paymentService.createPayment({ partner_id: ctx.supplierId, amount: 80,
      accounts: [{ account_id: ctx.accountId, amount: 20 }, { account_id: bank, amount: 60 }],
      allocations: [{ doc_id: order.id, amount: 80 }]
    })
    const data = createPrintService(ctx.db).a4Data(payment.id)
    expect(data.partnerName).toBe('李四供货')
    const html = renderA4Html(data)
    for (const text of ['现金', '银行&lt;核对&gt;', '60.00', order.no, '80.00']) expect(html).toContain(text)
    expect(html).not.toContain('<th>商品名称</th>')
  })

  it('rolls back split settlement on a mismatch, unrelated document, or second-ledger failure', () => {
    const doc = createDocService(ctx.db).create({ type: 'purchase', partner_id: ctx.supplierId, items: [{ product_id: 1, qty: 1, price: 100 }] })
    const bank = createFundService(ctx.db).create({ name: '对公账户', type: 'bank' })
    const input = {
      partner_id: ctx.supplierId, amount: 50, accounts: [{ account_id: ctx.accountId, amount: 20 }, { account_id: bank, amount: 30 }],
      allocations: [{ doc_id: doc.id, amount: 50 }]
    }
    expect(() => ctx.paymentService.createPayment({ ...input, amount: 55 })).toThrow(/合计/)
    expect(() => ctx.paymentService.createReceipt({ ...input, partner_id: ctx.customerId })).toThrow(/待核销/)
    ctx.db.exec(`CREATE TRIGGER block_bank BEFORE INSERT ON fund_flow WHEN NEW.account_id = ${bank} BEGIN SELECT RAISE(ABORT, 'test write failure'); END`)
    expect(() => ctx.paymentService.createPayment(input)).toThrow(/test write failure/)
    expect(ctx.db.prepare('SELECT COUNT(*) FROM fund_flow').pluck().get()).toBe(0)
    expect(ctx.db.prepare('SELECT COUNT(*) FROM payment_allocation').pluck().get()).toBe(0)
    expect(ctx.paymentService.openDocuments('payment', ctx.supplierId)[0]?.remaining).toBe(100)
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

  it.each([
    ['other_in', 'in'],
    ['other_out', 'out']
  ] as const)('posts %s to cash only', (type, direction) => {
    const doc = ctx.paymentService.createOne(type, { account_id: ctx.accountId, amount: 15 })
    expect(doc).toMatchObject({ type, account_id: ctx.accountId, total_amount: 15, partner_id: null })
    const detail = ctx.paymentService.getDetail(type, doc.id)
    expect(detail.flow).toMatchObject({ direction, amount: 15, doc_type: type })
    expect(ctx.paymentService.query(type, { page: 1, pageSize: 20 }).items).toHaveLength(1)
  })
})

// ── S 级功能批次 B：[10] 资金流水关联收支科目 ──
describe('payment.service category_id (S 批次 B)', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('writes fund_flow.category_id when valid; rejects unknown category', () => {
    const catId = Number(
      ctx.db.prepare("INSERT INTO income_category (name, kind) VALUES ('运费', 'expense')").run().lastInsertRowid
    )
    const doc = ctx.paymentService.createOne('other_out', { account_id: ctx.accountId, amount: 12.5, category_id: catId })
    const flow = ctx.db.prepare('SELECT category_id FROM fund_flow WHERE doc_id = ? AND doc_type = ?').get(doc.id, 'other_out') as { category_id: number | null }
    expect(flow.category_id).toBe(catId)
    expect(() => ctx.paymentService.createOne('other_out', { account_id: ctx.accountId, amount: 1, category_id: 99999 })).toThrow(/收支科目不存在/)
  })
})
