import { it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createReversalService } from '../../src/main/services/doc/reversal.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createSerialService } from '../../src/main/services/inventory/serial.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createTransferService } from '../../src/main/services/transfer/transfer.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createDocCopyService } from '../../src/main/services/doc/copy.service'
import type { DB } from '../../src/main/services/doc/doc.service'
import { BizError } from '../../src/shared/result'

interface InvRow {
  product_id: number
  warehouse_id: number
  batch_no: string
  qty: number
  moving_cost: number
}

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const purchaseService = createPurchaseService(db)
  const saleService = createSaleService(db)
  const transferService = createTransferService(db)
  const inventoryService = createInventoryService(db)
  const serialService = createSerialService(db)
  const docService = createDocService(db)
  const copyService = createDocCopyService(db)
  const paymentService = createPaymentService(db)
  const fundService = createFundService(db)
  const reversalService = createReversalService(db)

  const productId = productService.create({
    code: 'P001',
    name: '可乐',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none',
    units: [{ unit: '箱', rate: 12 }],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const wh2Id = warehouseService.create({ name: '分仓', is_default: false })
  const customerId = customerService.create({ code: 'C001', name: '测试客户', opening_receivable: 0 })
  const supplierId = supplierService.create({ code: 'S001', name: '测试供应商', opening_payable: 0 })

  function inv(): InvRow {
    return db
      .prepare('SELECT product_id, warehouse_id, batch_no, qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ?')
      .get(productId, whId) as InvRow
  }
  function invOf(pid: number, wid: number): InvRow[] {
    return db
      .prepare('SELECT product_id, warehouse_id, batch_no, qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ?')
      .all(pid, wid) as InvRow[]
  }

  return {
    db, docService, reversalService, purchaseService, saleService, transferService, copyService,
    paymentService, fundService, inventoryService, serialService, productService,
    productId, whId, wh2Id, customerId, supplierId, inv, invOf
  }
}

let ctx: ReturnType<typeof setup>
beforeEach(() => {
  ctx = setup()
})

it('采购单红冲：库存回退、金额取负、remark 与 reversal_of 正确', () => {
  const { purchaseService, reversalService, docService, productId, whId, inv, db } = ctx
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    supplier_id: ctx.supplierId,
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
  })
  expect(inv().qty).toBe(120)
  expect(inv().moving_cost).toBe(2)

  const rev = reversalService.reverse(doc.id, 'admin')
  expect(rev.type).toBe('purchase')
  expect(rev.reversal_of).toBe(doc.id)
  expect(rev.total_amount).toBe(-240)
  expect(rev.remark).toContain('红冲')
  expect(rev.remark).toContain(doc.no)
  expect(rev.status).toBe('done')
  // 库存清零
  expect(inv().qty).toBe(0)
  // 原单已标记被红冲
  const again = docService.getById(doc.id)
  expect(again?.reversal_of === undefined || again?.reversal_of === null).toBe(true)
  // 红冲单明细数量为负
  const items = docService.getItems(rev.id)
  expect(items[0]?.qty).toBe(-10)
  expect(items[0]?.amount).toBe(-240)
  // cost_log 记录了反向变动
  const logs = db.prepare("SELECT change_qty FROM cost_log WHERE source = 'reversal' AND source_id = ?").all(rev.id) as { change_qty: number }[]
  expect(logs.length).toBeGreaterThan(0)
  expect(logs.every((l) => l.change_qty < 0)).toBe(true)
})

it('销售单红冲：库存回正', () => {
  const { purchaseService, saleService, reversalService, productId, whId, inv } = ctx
  purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
  })
  const sale = saleService.create({
    warehouse_id: whId,
    customer_id: ctx.customerId,
    date: '2026-11-02',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 3, price: 36 }]
  })
  expect(inv().qty).toBe(84)
  reversalService.reverse(sale.id)
  expect(inv().qty).toBe(120)
  // 红冲单 total 为负
  const rev = reversalService.listReversals(sale.id)
  expect(rev.length).toBe(1)
  expect(rev[0]?.total_amount).toBe(-108)
})

it('销售红冲后库存不足：抛 NOT_ENOUGH 且全事务回滚', () => {
  const { purchaseService, saleService, reversalService, productId, whId, inv, db } = ctx
  purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 24 }]
  })
  const sale = saleService.create({
    warehouse_id: whId,
    customer_id: ctx.customerId,
    date: '2026-11-02',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 36 }]
  })
  expect(inv().qty).toBe(0)
  // 采购红冲需要出库 12，库存为 0 → NOT_ENOUGH
  const purchase = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-03',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 30 }]
  })
  // 先把第二批也卖光
  saleService.create({
    warehouse_id: whId,
    customer_id: ctx.customerId,
    date: '2026-11-04',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 36 }]
  })
  expect(inv().qty).toBe(0)
  expect(() => reversalService.reverse(purchase.id)).toThrow(BizError)
  try {
    reversalService.reverse(purchase.id)
  } catch (e) {
    expect((e as BizError).code).toBe('NOT_ENOUGH')
  }
  // 事务回滚：没有红冲单、没有 reversal cost_log
  expect(reversalService.listReversals(purchase.id).length).toBe(0)
  const logs = db.prepare("SELECT COUNT(*) AS c FROM cost_log WHERE source = 'reversal'").get() as { c: number }
  expect(logs.c).toBe(0)
  // 销售单红冲不受影响（红冲销售=入库回补 12）
  expect(reversalService.listReversals(sale.id).length).toBe(0)
  reversalService.reverse(sale.id)
  expect(inv().qty).toBe(12)
})

it('收款单红冲：生成反向 fund_flow，余额回正', () => {
  const { paymentService, fundService, reversalService, customerId, db } = ctx
  const bankId = fundService.create({ name: '测试银行', type: 'bank' })
  const receipt = paymentService.createReceipt({
    partner_id: customerId,
    account_id: bankId,
    amount: 500,
    date: '2026-11-02',
    allocations: []
  })
  const flowBefore = db.prepare('SELECT direction, amount FROM fund_flow WHERE doc_id = ?').get(receipt.id) as { direction: string; amount: number }
  expect(flowBefore.direction).toBe('in')
  reversalService.reverse(receipt.id)
  const revDoc = reversalService.listReversals(receipt.id)[0]
  const flows = db.prepare('SELECT direction, amount FROM fund_flow WHERE doc_id = ?').all(revDoc?.id) as { direction: string; amount: number }[]
  const outFlow = flows.find((f) => f.direction === 'out')
  expect(outFlow).toBeDefined()
  expect(outFlow?.amount).toBe(500)
  const revs = reversalService.listReversals(receipt.id)
  expect(revs.length).toBe(1)
  expect(revs[0]?.total_amount).toBe(-500)
})

it('收款单带核销：红冲后 allocation 删除', () => {
  const { purchaseService, paymentService, fundService, reversalService, productId, whId, supplierId, db } = ctx
  const bankId = fundService.create({ name: '测试银行2', type: 'bank' })
  purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    supplier_id: supplierId,
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
  })
  // 找到刚才的采购单 id（最新一张 purchase）
  const purchaseRow = db.prepare("SELECT id FROM doc WHERE type = 'purchase' ORDER BY id DESC LIMIT 1").get() as { id: number }
  const payment = paymentService.createPayment({
    partner_id: supplierId,
    account_id: bankId,
    amount: 200,
    date: '2026-11-02',
    allocations: [{ doc_id: purchaseRow.id, amount: 200 }]
  })
  const allocBefore = db.prepare('SELECT COUNT(*) AS c FROM payment_allocation WHERE payment_id = ?').get(payment.id) as { c: number }
  expect(allocBefore.c).toBe(1)
  const rev = reversalService.reverse(payment.id)
  expect(rev.reversal_of).toBe(payment.id)
  const allocAfter = db.prepare('SELECT COUNT(*) AS c FROM payment_allocation WHERE payment_id = ?').get(payment.id) as { c: number }
  expect(allocAfter.c).toBe(0)
  const flows = db.prepare('SELECT direction, amount FROM fund_flow WHERE doc_id = ?').all(rev.id) as { direction: string; amount: number }[]
  const reverseFlow = flows.find((f) => f.direction === 'in')
  expect(reverseFlow?.amount).toBe(200)
})

it('重复红冲拒绝', () => {
  const { purchaseService, reversalService, productId, whId } = ctx
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 24 }]
  })
  reversalService.reverse(doc.id)
  expect(() => reversalService.reverse(doc.id)).toThrow(BizError)
  try {
    reversalService.reverse(doc.id)
  } catch (e) {
    expect((e as BizError).code).toBe('VALIDATION')
    expect((e as BizError).message).toContain('红冲过')
  }
})

it('红冲单本身不可再红冲', () => {
  const { purchaseService, reversalService, productId, whId } = ctx
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 24 }]
  })
  const rev = reversalService.reverse(doc.id)
  expect(() => reversalService.reverse(rev.id)).toThrow(BizError)
})

it('草稿单拒绝红冲', () => {
  const { copyService, reversalService, productId, whId } = ctx
  // copy.service 生成的是草稿
  // 先做一张已过账采购单
  const { purchaseService } = ctx
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 24 }]
  })
  const draft = copyService.copy(doc.id)
  expect(draft.status).toBe('draft')
  expect(() => reversalService.reverse(draft.id)).toThrow(BizError)
  try {
    reversalService.reverse(draft.id)
  } catch (e) {
    expect((e as BizError).message).toContain('已过账')
  }
})

it('序列号采购单红冲：serial_number 回到 out 状态，写反向流水', () => {
  const { productService, purchaseService, reversalService, serialService, docService, db, whId } = ctx
  const snProductId = productService.create({
    code: 'P-SN',
    name: '手机',
    base_unit: '台',
    retail_price: 3000,
    trade_price: 2800,
    purchase_price: 2500,
    tracking_type: 'serial',
    units: [],
    barcodes: []
  })
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: snProductId, unit: '台', qty: 2, price: 2500, serial_numbers: ['SN-A1', 'SN-A2'] }]
  })
  expect(serialService.stockOf(snProductId)).toBe(2)
  const rev = reversalService.reverse(doc.id)
  expect(serialService.stockOf(snProductId)).toBe(0)
  // 台账两条都应被标记 out
  const rows = db.prepare('SELECT sn, status FROM serial_number WHERE product_id = ? ORDER BY sn').all(snProductId) as { sn: string; status: string }[]
  expect(rows.every((r) => r.status === 'out')).toBe(true)
  // 红冲单明细带负数量
  const items = docService.getItems(rev.id)
  expect(items[0]?.qty).toBe(-2)
})

it('transfer 红冲：两仓对称回退', () => {
  const { purchaseService, transferService, reversalService, productId, whId, wh2Id, invOf } = ctx
  purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
  })
  const tr = transferService.create({
    warehouse_id: whId,
    warehouse_in_id: wh2Id,
    date: '2026-11-02',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 4 }]
  })
  expect(invOf(productId, whId)[0]?.qty).toBe(72)
  expect(invOf(productId, wh2Id)[0]?.qty).toBe(48)
  reversalService.reverse(tr.id)
  expect(invOf(productId, whId)[0]?.qty).toBe(120)
  expect(invOf(productId, wh2Id)[0]?.qty).toBe(0)
})

it('listReversals 与 DocRow.reversal_of 透出', () => {
  const { purchaseService, reversalService, docService, productId, whId } = ctx
  const doc = purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 24 }]
  })
  expect(docService.getById(doc.id)?.reversal_of ?? null).toBeNull()
  const rev = reversalService.reverse(doc.id)
  const list = reversalService.listReversals(doc.id)
  expect(list.length).toBe(1)
  expect(list[0]?.id).toBe(rev.id)
  // 红冲单的详情能查到原单
  expect(rev.reversal_of).toBe(doc.id)
})

it('其他入库红冲：负向镜像单（docService.create 不动库存，仅验证镜像与金额）', () => {
  const { docService, reversalService, productId, whId } = ctx
  const other = docService.create({
    type: 'other_in',
    warehouse_id: whId,
    date: '2026-11-01',
    items: [{ product_id: productId, unit: '罐', qty: 5, price: 2 }]
  })
  const rev = reversalService.reverse(other.id)
  expect(rev.total_amount).toBe(-10)
  const items = docService.getItems(rev.id)
  expect(items[0]?.qty).toBe(-5)
  expect(items[0]?.amount).toBe(-10)
})

// P2 #8：盘点红冲 = 反向调整（盘盈入库的红冲出库、盘亏出库的红冲入库，恢复成本）
it('stocktake 红冲：反向调整恢复库存与成本', () => {
  const stocktakeService = createStocktakeService(ctx.db)
  const { purchaseService, reversalService, docService, productId, whId, inventoryService } = ctx
  purchaseService.create({
    warehouse_id: whId,
    items: [{ product_id: productId, unit: '罐', rate: 1, qty: 100, price: 2 }]
  })
  const before = ctx.inv()
  // 盘亏 30 → 库存 70
  const doc = stocktakeService.create({
    warehouse_id: whId,
    items: [{ product_id: productId, actual_qty: 70 }]
  })
  expect(doc.type).toBe('stocktake')
  expect(ctx.inv().qty).toBeCloseTo(70)
  const rev = reversalService.reverse(doc.id, 'tester')
  expect(rev.type).toBe('stocktake')
  expect(rev.reversal_of).toBe(doc.id)
  // 红冲后库存回到 100，成本不变
  const after = ctx.inv()
  expect(after.qty).toBeCloseTo(100)
  expect(after.moving_cost).toBeCloseTo(before.moving_cost)
  // 红冲单明细为反向数量
  const items = docService.getItems(rev.id)
  expect(items[0]?.qty).toBeCloseTo(-30)
  void inventoryService
})
