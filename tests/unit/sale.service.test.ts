import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const saleService = createSaleService(db)
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
  const batchProductId = productService.create({
    code: 'P002',
    name: '奶粉',
    base_unit: '罐',
    retail_price: 30,
    trade_price: 25,
    purchase_price: 20,
    tracking_type: 'batch',
    units: [],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const customerId = customerService.create({
    code: 'C001',
    name: '测试客户',
    opening_receivable: 0
  })
  return {
    db,
    saleService,
    purchaseService,
    inventoryService,
    productId,
    batchProductId,
    whId,
    customerId
  }
}

describe('sale.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  function stockUp(qty = 10, rate = 12, price = 24): void {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, unit: '箱', rate, qty, price }]
    })
  }

  it('create sale after purchase: inventory reduced by qty*rate, no /^XS/ check, total = Σ qty*price*rate', () => {
    stockUp(10, 12, 24) // 120 罐入库
    const doc = ctx.saleService.create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, unit: '箱', rate: 12, qty: 2, price: 36 }]
    })
    expect(doc.no).toMatch(/^XS\d{8}\d{4}$/)
    expect(doc.status).toBe('done')
    expect(doc.total_amount).toBeCloseTo(2 * 36 * 12)
    expect(doc.partner_id).toBe(ctx.customerId)
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.qty).toBeCloseTo(120 - 24)
  })

  it('selling more than stock throws NOT_ENOUGH and doc rolled back', () => {
    stockUp(1, 1, 2) // 库存 1
    expect(() =>
      ctx.saleService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 5, price: 3 }]
      })
    ).toThrowError(/库存不足/)
    const r = ctx.saleService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(0)
    // 库存未被错误扣减
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows[0]!.qty).toBeCloseTo(1)
  })

  it('cost_log entries carry source sale and source_id doc id', () => {
    stockUp(1, 1, 2)
    const doc = ctx.saleService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const logs = ctx.inventoryService.listCostLogs(ctx.productId)
    const saleLogs = logs.filter((l) => l.source === 'sale')
    expect(saleLogs.length).toBeGreaterThanOrEqual(1)
    expect(saleLogs[0]!.source_id).toBe(doc.id)
  })

  it('customer NOT_FOUND on bad id', () => {
    stockUp()
    expect(() =>
      ctx.saleService.create({
        customer_id: 99999,
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 1, price: 1 }]
      })
    ).toThrowError(/客户不存在/)
  })

  it('warehouse NOT_FOUND on bad id', () => {
    expect(() =>
      ctx.saleService.create({
        warehouse_id: 99999,
        items: [{ product_id: ctx.productId, qty: 1, price: 1 }]
      })
    ).toThrowError(/仓库不存在/)
  })

  it('VALIDATION on empty items', () => {
    expect(() => ctx.saleService.create({ warehouse_id: ctx.whId, items: [] })).toThrowError(/明细/)
  })

  it('VALIDATION on qty <= 0 or price < 0', () => {
    expect(() =>
      ctx.saleService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 0, price: 1 }]
      })
    ).toThrowError(/数量/)
    expect(() =>
      ctx.saleService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 1, price: -1 }]
      })
    ).toThrowError(/单价/)
  })

  it('getDetail returns doc and items; wrong type NOT_FOUND', () => {
    stockUp()
    const doc = ctx.saleService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const detail = ctx.saleService.getDetail(doc.id)
    expect(detail.doc.id).toBe(doc.id)
    expect(detail.items).toHaveLength(1)
    // 采购单不是销售单 → NOT_FOUND
    const pdoc = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 2 }]
    })
    expect(() => ctx.saleService.getDetail(pdoc.id)).toThrowError(/销售单不存在/)
  })

  it('query with partner_id filter returns only that customer docs', () => {
    stockUp()
    const customerService = createCustomerService(dbOf(ctx))
    const otherId = customerService.create({ code: 'C002', name: '客户2', opening_receivable: 0 })
    ctx.saleService.create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    ctx.saleService.create({
      customer_id: otherId,
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const r = ctx.saleService.query({ page: 1, pageSize: 20, partner_id: ctx.customerId })
    expect(r.total).toBe(1)
    expect(r.items[0]!.partner_id).toBe(ctx.customerId)
    const all = ctx.saleService.query({ page: 1, pageSize: 20 })
    expect(all.total).toBe(2)
  })

  it('batch product sale: batch_no row decremented', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.batchProductId, batch_no: 'B1', qty: 5, price: 20 }]
    })
    ctx.saleService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.batchProductId, batch_no: 'B1', qty: 2, price: 30 }]
    })
    const rows = ctx.inventoryService.getByProduct(ctx.batchProductId, ctx.whId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.batch_no).toBe('B1')
    expect(rows[0]!.qty).toBeCloseTo(3)
  })
})

// 小工具：从 ctx 取 db（保持 setup 返回结构稳定）
function dbOf(ctx: ReturnType<typeof setup>): DB {
  return ctx.db
}
