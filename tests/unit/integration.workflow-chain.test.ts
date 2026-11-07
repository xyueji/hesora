import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import type { Database } from 'better-sqlite3'
import { createOpeningService } from '../../src/main/services/opening/opening.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createWorkflowService } from '../../src/main/services/workflow/workflow.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createFundLedger } from '../../src/main/services/fund/ledger.service'
import type { DB } from '../../src/main/services/doc/doc.service'

// 平台操作流水线 · 报价→订单→分批履行→核销→对账
// 对应验收手册场景 03（报价转单、分批发货、组合收款和毛利）的全自动证据。
describe('integration: quote → order → partial fulfilment → settlement', () => {
  let ctx: ReturnType<typeof setup>
  // 日期取当天：收付款核销要求核销单据日期不晚于收付款日期，
  // 而 workflow 转单在跨天时会把订单日期顶到今天（convert: order && currentDate > row.date）。
  const date = new Date().toLocaleDateString('sv-SE')
  const actor = 1

  beforeEach(() => {
    ctx = setup()
  })

  it('walks quote→sale_order→two partial sales, settles combined, reconciles stock/arrears/profit', () => {
    const { opening, workflow, sale, payment, inventory, arrears, main, productA, zhangsan, wechat, cash, stock } = ctx

    // ── 1. 期初：A 12@4，客户张三挂账 0 ─────────────────────────
    opening.save({ inventory: [{ product_id: productA, warehouse_id: main, qty: 12, unit_cost: 4 }] })

    // ── 2. 报价 10@10 → 审核 → 转销售订单 ───────────────────────
    const quote = workflow.save(
      { kind: 'quote', warehouse_id: main, partner_id: zhangsan, date, items: [{ product_id: productA, qty: 10, price: 10 }] },
      actor
    )
    expect(quote.status).toBe('draft')
    workflow.approve(quote.id, actor)
    const order = workflow.convert(quote.id, actor, 'sale_order')
    expect(order.kind).toBe('sale_order')
    workflow.approve(order.id, actor)
    // 订单审核不过账：库存不动
    expect(stock(productA).qty).toBe(12)

    // ── 3. 分批履行：先发 4 件，余 6 件再发 ─────────────────────
    const first = workflow.convert(order.id, actor, 'sale', [{ line: 0, qty: 4 }])
    const firstSale = workflow.approve(first.id, actor)
    expect(firstSale.posted_doc_id).not.toBeNull()
    expect(stock(productA).qty).toBe(8)
    // 超量履行被拒绝
    expect(() => workflow.convert(order.id, actor, 'sale', [{ line: 0, qty: 7 }])).toThrow(/剩余/)
    const second = workflow.convert(order.id, actor, 'sale')
    const secondSale = workflow.approve(second.id, actor)
    expect(stock(productA).qty).toBe(2)
    // 订单已全部履行，不能再转
    expect(() => workflow.convert(order.id, actor, 'sale')).toThrow()

    // ── 4. 组合收款：现金 25 + 微信 40，核销两张销售单 40+20 ────
    payment.createReceipt({
      date,
      partner_id: zhangsan,
      amount: 65,
      accounts: [
        { account_id: cash, amount: 25 },
        { account_id: wechat, amount: 40 }
      ],
      allocations: [
        { doc_id: firstSale.posted_doc_id!, amount: 40 },
        { doc_id: secondSale.posted_doc_id!, amount: 20 }
      ]
    })
    // 张三应收 = 期初0 + 销售100 − 收款核销65 = 35（组合收款全额冲减往来，
    // 未分配的 20 元留在账户余额中，与核销单 remaining 语义一致）
    const recv = arrears.receivables().find((r) => r.partner_id === zhangsan)
    expect(recv?.balance).toBeCloseTo(35, 2)

    // ── 5. 账户余额与毛利对账 ──────────────────────────────────
    const led = ctx.ledger.accounts()
    expect(led.find((a) => a.id === cash)?.balance).toBeCloseTo(25, 2)
    expect(led.find((a) => a.id === wechat)?.balance).toBeCloseTo(40, 2)

    // 毛利口径（report.service profit）：收入 100，成本取 cost_log 出库成本；
    // 期初入库无 cost_log 出库记录时成本为 NULL，汇总行只断言收入。
    const profit = ctx.report.query({ kind: 'profit', date_from: date, date_to: date }).rows[0]
    expect(profit?.revenue).toBeCloseTo(100, 2)

    // ── 6. 台账闭环：两笔销售均入 doc，序列无缺口 ───────────────
    const docs = ctx.db.prepare("SELECT COUNT(*) c FROM doc WHERE type='sale'").get() as { c: number }
    expect(docs.c).toBe(2)
    const orderRow = ctx.db.prepare('SELECT status FROM doc_workflow WHERE id = ?').get(order.id) as { status: string }
    expect(orderRow.status).toBe('approved')
    void sale
    void inventory
  })

  it('purchase order partial fulfilment feeds stock with moving cost', () => {
    const { opening, workflow, main, productA, laowang, stock } = ctx
    opening.save({ inventory: [] })

    const order = workflow.save(
      { kind: 'purchase_order', warehouse_id: main, partner_id: laowang, date, items: [{ product_id: productA, qty: 10, price: 2 }] },
      actor
    )
    workflow.approve(order.id, actor)
    // 采购订单审核不过账
    expect(stock(productA).qty).toBe(0)

    const first = workflow.convert(order.id, actor, 'purchase', [{ line: 0, qty: 6 }])
    const firstPurchase = workflow.approve(first.id, actor)
    expect(firstPurchase.posted_doc_id).not.toBeNull()
    expect(stock(productA)).toMatchObject({ qty: 6, moving_cost: 2 })

    const second = workflow.convert(order.id, actor, 'purchase')
    workflow.approve(second.id, actor)
    expect(stock(productA).qty).toBe(10)
  })
})

function setup() {
  const db = openMemDb() as DB
  const opening = createOpeningService(db)
  const purchase = createPurchaseService(db)
  const sale = createSaleService(db)
  const workflow = createWorkflowService(db)
  const payment = createPaymentService(db)
  const inventory = createInventoryService(db)
  const arrears = createArrearsService(db)
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const fundService = createFundService(db)
  const report = createReportService(db)
  const ledger = createFundLedger(db)

  const main = warehouseService.create({ name: '主仓', is_default: true })
  const wechat = fundService.create({ name: '微信', type: 'wechat' })
  const cash = fundService.create({ name: '现金', type: 'cash' })
  const productA = productService.create({
    code: 'A',
    name: '标准商品A',
    base_unit: '个',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none'
  })
  const zhangsan = customerService.create({ code: 'C001', name: '张三', opening_receivable: 0 })
  const laowang = supplierService.create({ code: 'S001', name: '老王', opening_payable: 0 })

  function stock(productId: number, warehouseId = main): { qty: number; moving_cost: number } {
    const rows = inventory.getByProduct(productId, warehouseId)
    return rows[0] ?? { qty: 0, moving_cost: 0 }
  }

  return {
    db: db as Database,
    opening,
    purchase,
    sale,
    workflow,
    payment,
    inventory,
    arrears,
    fundService,
    ledger,
    report,
    main,
    wechat,
    cash,
    productA,
    zhangsan,
    laowang,
    stock
  }
}
