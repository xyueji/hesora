import { describe, it, expect, beforeEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openMemDb } from '../helpers/mem-db'
import { createStatementService } from '../../src/main/services/stats/statement.service'
import type { StatementLine } from '../../src/shared/types/stats'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'

// P1 功能 #1：客户/供应商对账单明细 + 账龄分析。
// 对账单口径：应收 = 销售 + 期初 + 退货冲减 − 收款核销；应付对称。
// 账龄口径：未核销金额（doc 金额 − payment_allocation 已分配）按单据日期分桶。
describe('statement.service', () => {
  let db: Database
  let svc: ReturnType<typeof createStatementService>

  beforeEach(() => {
    db = openMemDb()
    svc = createStatementService(db)
  })

  function setup(openingReceivable = 0, openingPayable = 0): {
    customerId: number
    supplierId: number
    accountId: number
    warehouseId: number
    productId: number
  } {
    const customer = createCustomerService(db)
    const supplier = createSupplierService(db)
    const fund = createFundService(db)
    const customerId = customer.create({ code: 'C001', name: '客户甲', opening_receivable: openingReceivable })
    const supplierId = supplier.create({ code: 'S001', name: '供应商乙', opening_payable: openingPayable })
    const accountId = fund.create({ name: '现金', type: 'cash' })
    const warehouseId = Number(
      db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
    )
    const productId = Number(
      db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
    )
    db.prepare("INSERT INTO inventory (warehouse_id, product_id, qty, moving_cost) VALUES (?, ?, 1000, 1)")
      .run(warehouseId, productId)
    return { customerId, supplierId, accountId, warehouseId, productId }
  }

  const doSale = (customerId: number, warehouseId: number, productId: number, price: number, date: string): number =>
    createSaleService(db).create({
      customer_id: customerId, warehouse_id: warehouseId, date,
      items: [{ product_id: productId, qty: 1, price }]
    }).id

  const linesOf = (rows: StatementLine[], type: string): StatementLine[] => rows.filter((r) => r.type === type)

  describe('statement（对账单明细）', () => {
    it('期初余额 + 逐笔滚动余额正确（客户应收口径）', () => {
      const { customerId, warehouseId, productId } = setup(100)
      doSale(customerId, warehouseId, productId, 200, '2026-09-01')
      doSale(customerId, warehouseId, productId, 300, '2026-10-01')
      const r = svc.statement({ partner_id: customerId, partner_type: 'customer' })

      expect(r.partner_id).toBe(customerId)
      expect(r.partner_name).toBe('客户甲')
      expect(r.opening_balance).toBe(100)
      expect(r.closing_balance).toBe(600)
      // 两笔销售行，余额滚动：100+200=300 → 300+300=600
      const sales = linesOf(r.lines, 'sale')
      expect(sales.length).toBe(2)
      expect(sales[0]).toMatchObject({ date: '2026-09-01', amount: 200, balance: 300 })
      expect(sales[1]).toMatchObject({ date: '2026-10-01', amount: 300, balance: 600 })
      // 无收款行
      expect(linesOf(r.lines, 'receipt').length).toBe(0)
    })

    it('收付款核销行冲减余额', () => {
      const base = setup(0)
      const customerId = base.customerId
      const accountId = base.accountId
      const saleDocId = doSale(base.customerId, base.warehouseId, base.productId, 500, '2026-09-01')
      createPaymentService(db).createReceipt({
        partner_id: customerId, account_id: accountId, amount: 200, date: '2026-09-15',
        allocations: [{ doc_id: saleDocId, amount: 200 }]
      })
      const r = svc.statement({ partner_id: customerId, partner_type: 'customer' })
      expect(r.opening_balance).toBe(0)
      expect(r.closing_balance).toBe(300)
      const receipt = linesOf(r.lines, 'receipt')[0]
      expect(receipt).toMatchObject({ date: '2026-09-15', amount: 200, direction: 'decrease' })
      const sale = linesOf(r.lines, 'sale')[0]!
      expect(sale.balance).toBe(500)
      expect(receipt!.balance).toBe(300)
    })

    it('未指定核销的收款也计入明细（余额直接冲减）', () => {
      const { customerId, accountId, warehouseId, productId } = setup(100)
      doSale(customerId, warehouseId, productId, 400, '2026-09-01')
      createPaymentService(db).createReceipt({
        partner_id: customerId, account_id: accountId, amount: 250, date: '2026-09-20'
      })
      const r = svc.statement({ partner_id: customerId, partner_type: 'customer' })
      expect(r.closing_balance).toBe(250) // 100 + 400 − 250
    })

    it('退货冲减行（红冲）进入明细且减少应收', () => {
      const { customerId, warehouseId, productId } = setup(0)
      const saleId = doSale(customerId, warehouseId, productId, 300, '2026-09-01')
      createSaleService(db).createReturn({
        customer_id: customerId, warehouse_id: warehouseId, source_doc_id: saleId, date: '2026-09-05',
        items: [{ product_id: productId, qty: 1, price: 100 }]
      })
      const r = svc.statement({ partner_id: customerId, partner_type: 'customer' })
      expect(r.closing_balance).toBe(200)
      const ret = linesOf(r.lines, 'sale_return')[0]
      expect(ret).toMatchObject({ date: '2026-09-05', amount: 100, direction: 'decrease', balance: 200 })
    })

    it('供应商应付口径：采购增加、退货与付款冲减', () => {
      const { supplierId, accountId, warehouseId, productId } = setup(0, 50)
      createPurchaseService(db).create({
        supplier_id: supplierId, warehouse_id: warehouseId, date: '2026-09-01',
        items: [{ product_id: productId, qty: 2, price: 100 }]
      })
      const purchaseId = Number(db.prepare("SELECT id FROM doc WHERE type='purchase'").pluck().get())
      createPaymentService(db).createPayment({
        partner_id: supplierId, account_id: accountId, amount: 120, date: '2026-09-10',
        allocations: [{ doc_id: purchaseId, amount: 120 }]
      })
      const r = svc.statement({ partner_id: supplierId, partner_type: 'supplier' })
      expect(r.opening_balance).toBe(50)
      expect(r.closing_balance).toBe(130) // 50 + 200 − 120
      const pay = linesOf(r.lines, 'payment')[0]
      expect(pay).toMatchObject({ direction: 'decrease', amount: 120 })
    })

    it('date_from 过滤：期初为过滤起点前的净额，期内单据逐笔滚动', () => {
      const { customerId, warehouseId, productId } = setup(100)
      doSale(customerId, warehouseId, productId, 200, '2026-09-01')
      doSale(customerId, warehouseId, productId, 300, '2026-10-01')
      const r = svc.statement({ partner_id: customerId, partner_type: 'customer', date_from: '2026-09-15' })
      expect(r.opening_balance).toBe(300) // 期初 100 + 9-01 销售 200
      expect(r.closing_balance).toBe(600)
      expect(r.lines.length).toBe(1) // 9-01 的销售在期初之前，不进明细行
      expect(r.lines[0]).toMatchObject({ date: '2026-10-01', balance: 600 })
    })

    it('partner 不存在抛 NOT_FOUND', () => {
      expect(() => svc.statement({ partner_id: 99999, partner_type: 'customer' })).toThrowError(/客户不存在/)
      expect(() => svc.statement({ partner_id: 99999, partner_type: 'supplier' })).toThrowError(/供应商不存在/)
    })
  })

  describe('aging（账龄分析）', () => {
    it('未核销金额按单据日期分桶（0-30/31-60/61-90/90+）', () => {
      const { customerId, warehouseId, productId } = setup(0)
      doSale(customerId, warehouseId, productId, 100, '2026-11-01') // 8 天 → 0-30
      doSale(customerId, warehouseId, productId, 200, '2026-10-05') // 35 天 → 31-60
      doSale(customerId, warehouseId, productId, 300, '2026-09-20') // 50 天 → 31-60
      doSale(customerId, warehouseId, productId, 400, '2026-09-01') // 69 天 → 61-90
      doSale(customerId, warehouseId, productId, 500, '2026-07-01') // 131 天 → 90+
      const r = svc.aging({ partner_type: 'customer', as_of: '2026-11-09' })
      const row = r.rows.find((x) => x.partner_id === customerId)
      expect(row).toBeDefined()
      expect(row!.balance).toBe(1500)
      expect(row!.bucket_0_30).toBe(100)
      expect(row!.bucket_31_60).toBe(500)
      expect(row!.bucket_61_90).toBe(400)
      expect(row!.bucket_90p).toBe(500)
      expect(r.total.balance).toBe(1500)
      expect(r.total.bucket_0_30).toBe(100)
    })

    it('核销冲减对应单据的未核销金额（allocation 口径）', () => {
      const { customerId, accountId, warehouseId, productId } = setup(0)
      const oldId = doSale(customerId, warehouseId, productId, 300, '2026-09-01') // 69 天 → 61-90
      doSale(customerId, warehouseId, productId, 100, '2026-11-01') // 0-30
      createPaymentService(db).createReceipt({
        partner_id: customerId, account_id: accountId, amount: 300, date: '2026-11-09',
        allocations: [{ doc_id: oldId, amount: 300 }]
      })
      const r = svc.aging({ partner_type: 'customer', as_of: '2026-11-09' })
      const row = r.rows.find((x) => x.partner_id === customerId)!
      expect(row.balance).toBe(100)
      expect(row.bucket_0_30).toBe(100)
      expect(row.bucket_61_90).toBe(0)
    })

    it('期初余额归入 90+ 档', () => {
      const { customerId } = setup(600)
      const r = svc.aging({ partner_type: 'customer', as_of: '2026-11-09' })
      const row = r.rows.find((x) => x.partner_id === customerId)!
      expect(row.balance).toBe(600)
      expect(row.bucket_90p).toBe(600)
    })

    it('无余额客商不出现；供应商账龄同理', () => {
      const { supplierId, warehouseId, productId } = setup(0)
      createPurchaseService(db).create({
        supplier_id: supplierId, warehouse_id: warehouseId, date: '2026-10-01',
        items: [{ product_id: productId, qty: 1, price: 200 }]
      })
      const r = svc.aging({ partner_type: 'supplier', as_of: '2026-11-09' })
      expect(r.rows.some((x) => x.partner_id === supplierId)).toBe(true)
      expect(r.rows.every((x) => x.balance > 0)).toBe(true)
    })
  })
})
