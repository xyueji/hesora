import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createFundLedger } from '../../src/main/services/fund/ledger.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createOpeningService } from '../../src/main/services/opening/opening.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createWorkflowService } from '../../src/main/services/workflow/workflow.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createTransferService } from '../../src/main/services/transfer/transfer.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createAssembleService } from '../../src/main/services/assemble/assemble.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createUserService } from '../../src/main/services/user/user.service'

const date = new Date().toLocaleDateString('sv-SE')
const actor = 1

function fixture() {
  const db = openMemDb()
  const product = createProductService(db)
  const warehouse = createWarehouseService(db)
  const funds = createFundService(db)
  const ledger = createFundLedger(db)
  const opening = createOpeningService(db)
  const workflow = createWorkflowService(db)
  const purchase = createPurchaseService(db)
  const sale = createSaleService(db)
  const payment = createPaymentService(db)
  const inventory = createInventoryService(db)
  const arrears = createArrearsService(db)
  const customer = createCustomerService(db).create({ code: 'C001', name: '测试客户', opening_receivable: 0 })
  const supplier = createSupplierService(db).create({ code: 'S001', name: '测试供应商', opening_payable: 0 })
  const main = warehouse.create({ name: '总仓', is_default: true })
  const sub = warehouse.create({ name: '副仓', is_default: false })
  const item = (code: string) => product.create({ code, name: code, base_unit: '件', tracking_type: 'none', barcodes: [`999-${code}`], retail_price: 0, trade_price: 0, purchase_price: 0, units: [] })
  const stock = (id: number, wh = main) => inventory.getByProduct(id, wh)[0] ?? { qty: 0, moving_cost: 0 }
  const balance = (id: number) => ledger.accounts().find((account) => account.id === id)?.balance
  const recv = () => arrears.receivables().find((row) => row.partner_id === customer)?.balance
  const pay = () => arrears.payables().find((row) => row.partner_id === supplier)?.balance
  const account = (name: string, opening_balance = 0) => funds.create({ name, type: name === '现金' ? 'cash' : 'bank', opening_balance })
  function state() {
    return ['doc', 'doc_item', 'doc_workflow', 'fund_flow', 'payment_allocation', 'inventory', 'cost_log', 'retail_held', 'fund_transfer'].map((table) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  }
  function receive(id: number, qty: number, price: number) {
    return purchase.create({ warehouse_id: main, supplier_id: supplier, date, items: [{ product_id: id, qty, price }] })
  }
  return { db, product, opening, workflow, purchase, sale, payment, ledger, customer, supplier, main, sub, item, stock, balance, recv, pay, account, state, receive }
}

describe.sequential('业务验收手册 01–08', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => { f = fixture() })
  afterEach(() => f.db.close())

  it('01 期初建账、开始营业、拒绝重复建账', () => {
    const a = f.item('A')
    const cash = f.account('现金', 100)
    const input = { inventory: [{ product_id: a, warehouse_id: f.main, qty: 100, unit_cost: 2 }],
      customers: [{ customer_id: f.customer, receivable: 20 }], suppliers: [{ supplier_id: f.supplier, payable: 30 }] }
    f.opening.save(input)
    f.sale.create({ customer_id: f.customer, warehouse_id: f.main, date, items: [{ product_id: a, qty: 2, price: 3 }] })
    expect(f.stock(a)).toMatchObject({ qty: 98, moving_cost: 2 })
    expect([f.recv(), f.pay(), f.balance(cash)]).toEqual([26, 30, 100])
    const before = f.state()
    expect(() => f.opening.save(input)).toThrow()
    expect(f.state()).toEqual(before)
  })

  it('02 采购分批、超量和取消、付款核销', () => {
    const a = f.item('A')
    const cash = f.account('现金', 100)
    const bank = f.account('银行', 100)
    const w = f.workflow
    const order = w.save({ kind: 'purchase_order', warehouse_id: f.main, partner_id: f.supplier, date,
      items: [{ product_id: a, qty: 10, price: 5 }] }, actor)
    w.approve(order.id, actor)
    const first = w.convert(order.id, actor, 'purchase', [{ line: 0, qty: 6 }])
    expect([f.stock(a).qty, w.get(order.id).fulfillment?.lines[0]?.remaining]).toEqual([0, 4])
    expect(() => w.convert(order.id, actor, 'purchase', [{ line: 0, qty: 5 }])).toThrow(/剩余/)
    const posted = w.approve(first.id, actor)
    expect([f.stock(a).qty, f.pay()]).toEqual([6, 30])
    const discarded = w.convert(order.id, actor, 'purchase')
    w.cancel(discarded.id, actor)
    const second = w.approve(w.convert(order.id, actor, 'purchase').id, actor)
    const paid = f.payment.createPayment({ date, partner_id: f.supplier, amount: 25, accounts: [
      { account_id: cash, amount: 10 }, { account_id: bank, amount: 15 }
    ], allocations: [{ doc_id: posted.posted_doc_id!, amount: 25 }] })
    const open = f.payment.openDocuments('payment', f.supplier)
    expect(open.map((row) => [row.id, row.remaining])).toEqual([[posted.posted_doc_id, 5], [second.posted_doc_id, 20]])
    expect(f.payment.getPaymentDetail(paid.id).flows.map((row) => row.amount)).toEqual([10, 15])
    expect(w.get(order.id).fulfillment).toMatchObject({ state: 'completed', lines: [{ posted: 10, reserved: 0 }] })
    expect([f.stock(a).qty, f.stock(a).moving_cost, f.pay(), f.balance(cash), f.balance(bank)]).toEqual([10, 5, 25, 90, 85])
    expect(() => w.approve(first.id, actor)).toThrow(/草稿/)
    expect(f.stock(a).qty).toBe(10)
  })

  it('03 报价转单、分批发货、组合收款和毛利', () => {
    const a = f.item('A')
    f.opening.save({ inventory: [{ product_id: a, warehouse_id: f.main, qty: 12, unit_cost: 4 }] })
    const cash = f.account('现金')
    const bank = f.account('银行')
    const w = f.workflow
    const quote = w.save({ kind: 'quote', warehouse_id: f.main, partner_id: f.customer, date,
      items: [{ product_id: a, qty: 10, price: 10 }] }, actor)
    w.approve(quote.id, actor)
    const order = w.convert(quote.id, actor, 'sale_order')
    w.approve(order.id, actor)
    expect(f.stock(a).qty).toBe(12)
    const first = w.approve(w.convert(order.id, actor, 'sale', [{ line: 0, qty: 4 }]).id, actor)
    const second = w.approve(w.convert(order.id, actor, 'sale').id, actor)
    f.payment.createReceipt({ date, partner_id: f.customer, amount: 65,
      accounts: [{ account_id: cash, amount: 25 }, { account_id: bank, amount: 40 }], allocations: [
        { doc_id: first.posted_doc_id!, amount: 40 }, { doc_id: second.posted_doc_id!, amount: 20 }
      ] })
    expect([f.stock(a).qty, f.recv(), f.balance(cash), f.balance(bank)]).toEqual([2, 35, 25, 40])
    expect(f.payment.openDocuments('receipt', f.customer)).toMatchObject([{ id: second.posted_doc_id, remaining: 40 }])
    expect(createReportService(f.db).query({ kind: 'profit', date_from: date, date_to: date }).rows).toMatchObject([{ revenue: 100, cost: 40, profit: 60 }])
    const before = f.state()
    expect(() => f.payment.createReceipt({ partner_id: f.customer, account_id: cash, amount: 40.01,
      allocations: [{ doc_id: second.posted_doc_id!, amount: 40.01 }] })).toThrow(/待核销/)
    expect(f.state()).toEqual(before)
  })

  it('04 扫码、挂单隔离、结算及库存不足保留草稿', () => {
    const a = f.item('A')
    f.receive(a, 5, 2)
    expect(f.product.getByBarcode('999-A')?.id).toBe(a)
    const cash = f.account('现金')
    const users = createUserService(f.db)
    const owner = users.create({ username: '收银员甲', password: 'Smoke-a-218', role: 'cashier' })
    const other = users.create({ username: '收银员乙', password: 'Smoke-b-218', role: 'cashier' })
    const retail = createRetailService(f.db)
    const cart = { warehouse_id: f.main, date, account_id: cash, items: [{ product_id: a, qty: 2, price: 3 }] }
    const held = retail.hold(owner.id, cart)
    expect([f.stock(a).qty, f.balance(cash), retail.listHeld(other.id).length]).toEqual([5, 0, 0])
    expect(() => retail.create({ ...cart, held_id: held }, other.id)).toThrow(/挂单/)
    const result = retail.create({ ...cart, held_id: held }, owner.id)
    expect([result.total_amount, f.stock(a).qty, f.balance(cash)]).toEqual([6, 3, 6])
    expect(() => retail.create({ ...cart, held_id: held }, owner.id)).toThrow(/挂单/)
    const tooMany = { ...cart, items: [{ product_id: a, qty: 4, price: 3 }] }
    const pending = retail.hold(owner.id, tooMany)
    const before = f.state()
    expect(() => retail.create({ ...tooMany, held_id: pending }, owner.id)).toThrow(/库存不足/)
    expect(f.state()).toEqual(before)
  })

  it.each([false, true])('05 关联原单退货及超退拦截（实际退款 %s）', (refund) => {
    const a = f.item('A')
    const cash = f.account('现金')
    const purchase = f.receive(a, 10, 4)
    const sale = f.sale.create({ customer_id: f.customer, warehouse_id: f.main, date, items: [{ product_id: a, qty: 4, price: 10 }] })
    if (refund) f.payment.createReceipt({ date, partner_id: f.customer, account_id: cash, amount: 40, allocations: [{ doc_id: sale.id, amount: 40 }] })
    const input = { source_doc_id: sale.id, customer_id: f.customer, warehouse_id: f.main, date,
      account_id: refund ? cash : undefined, items: [{ product_id: a, qty: 1, price: 10 }] }
    expect(f.sale.createReturn(input).source_doc_id).toBe(sale.id)
    expect([f.stock(a).qty, f.recv(), f.balance(cash)]).toEqual(refund ? [7, 0, 30] : [7, 30, 0])
    const before = f.state()
    expect(() => f.sale.createReturn({ ...input, items: [{ product_id: a, qty: 4, price: 10 }] })).toThrow(/可退|超|数量/)
    expect(f.state()).toEqual(before)
    if (refund) f.payment.createPayment({ date, partner_id: f.supplier, account_id: cash, amount: 40, allocations: [{ doc_id: purchase.id, amount: 40 }] })
    f.purchase.createReturn({ source_doc_id: purchase.id, supplier_id: f.supplier, warehouse_id: f.main, date,
      account_id: refund ? cash : undefined, items: [{ product_id: a, qty: 1, price: 4 }] })
    expect([f.stock(a).qty, f.pay(), f.balance(cash)]).toEqual(refund ? [6, 0, -6] : [6, 36, 0])
  })

  it('06 调拨与盘点均按仓库记录差异', () => {
    const b = f.item('B')
    f.receive(b, 50, 5)
    const transfer = createTransferService(f.db)
    const stocktake = createStocktakeService(f.db)
    const move = { warehouse_id: f.main, warehouse_in_id: f.sub, date, items: [{ product_id: b, qty: 10 }] }
    transfer.create(move)
    expect([f.stock(b).qty, f.stock(b, f.sub).qty, f.stock(b, f.sub).moving_cost]).toEqual([40, 10, 5])
    stocktake.create({ warehouse_id: f.main, date, items: [{ product_id: b, actual_qty: 39 }] })
    expect([f.stock(b).qty, f.stock(b, f.sub).qty]).toEqual([39, 10])
    expect(f.db.prepare('SELECT SUM(qty * moving_cost) FROM inventory').pluck().get()).toBe(245)
    const before = f.state()
    expect(() => transfer.create({ ...move, items: [{ product_id: b, qty: 40 }] })).toThrow(/库存不足/)
    expect(() => stocktake.create({ warehouse_id: f.main, items: [{ product_id: b, actual_qty: 39 }, { product_id: b, actual_qty: 38 }] })).toThrow(/重复/)
    expect(f.state()).toEqual(before)
  })

  it('07 套装组装拆卸与价值守恒', () => {
    const a = f.item('A')
    const b = f.item('B')
    const c = f.product.create({ code: 'C', name: '套装', base_unit: '套', tracking_type: 'none', kind: 'combo',
      retail_price: 0, trade_price: 0, purchase_price: 0, units: [],
      bom: [{ product_id: a, qty: 2 }, { product_id: b, qty: 1 }] })
    f.receive(a, 20, 2)
    f.receive(b, 10, 5)
    const bom = createAssembleService(f.db)
    bom.create({ warehouse_id: f.main, combo_id: c, qty: 10 })
    expect([f.stock(a).qty, f.stock(b).qty, f.stock(c).qty, f.stock(c).moving_cost]).toEqual([0, 0, 10, 9])
    bom.disassemble({ warehouse_id: f.main, combo_id: c, qty: 5 })
    expect([f.stock(a).qty, f.stock(a).moving_cost, f.stock(b).qty, f.stock(b).moving_cost, f.stock(c).qty]).toEqual([10, 3, 5, 3, 5])
    expect(f.db.prepare('SELECT SUM(qty * moving_cost) FROM inventory').pluck().get()).toBe(90)
    const before = f.state()
    expect(() => bom.disassemble({ warehouse_id: f.main, combo_id: c, qty: 6 })).toThrow(/库存不足/)
    expect(f.state()).toEqual(before)
  })

  it('08 资金交班、两边分录与对外收支', () => {
    const cash = f.account('现金', 200)
    const bank = f.account('银行', 100)
    const move = f.ledger.transfer({ from: cash, to: bank, date, amount: 50.25 }, actor)
    expect(f.ledger.entries(cash, 1).list[0]).toMatchObject({ no: move.no, direction: 'out' })
    expect(f.ledger.entries(bank, 1).list[0]).toMatchObject({ no: move.no, direction: 'in' })
    f.payment.createOne('other_in', { date, account_id: cash, amount: 20 })
    f.payment.createOne('other_out', { date, account_id: bank, amount: 10 })
    expect([f.balance(cash), f.balance(bank)]).toEqual([169.75, 140.25])
    const report = createReportService(f.db)
    expect(report.query({ kind: 'fund', date_from: date, date_to: date }).totals).toEqual({ income: 20, expense: 10 })
    expect(report.query({ kind: 'fund', date_from: date, date_to: date, account_id: cash }).rows).toHaveLength(2)
    const before = f.state()
    expect(() => f.ledger.transfer({ from: cash, to: cash, date, amount: 2 }, actor)).toThrow(/不同/)
    expect(() => f.ledger.transfer({ from: cash, to: bank, date, amount: 170 }, actor)).toThrow(/余额不足/)
    expect(f.state()).toEqual(before)
  })
})
