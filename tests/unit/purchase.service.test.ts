import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const supplierService = createSupplierService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
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
  const supplierId = supplierService.create({
    code: 'S001',
    name: '测试供应商',
    opening_payable: 0
  })
  return { db, purchaseService, inventoryService, productId, batchProductId, whId, supplierId }
}

describe('purchase.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('create: doc no starts with CG, status done, total = Σ qty*price*rate', () => {
    const doc = ctx.purchaseService.create({
      supplier_id: ctx.supplierId,
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
    })
    expect(doc.no).toMatch(/^CG\d{8}\d{4}$/)
    expect(doc.status).toBe('done')
    expect(doc.total_amount).toBeCloseTo(10 * 24 * 12)
    expect(doc.warehouse_id).toBe(ctx.whId)
    expect(doc.partner_id).toBe(ctx.supplierId)
  })

  it('create: inventory updated with base qty and unit cost per base unit (10箱@rate12, price24 → 120 @ 2.0)', () => {
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
    })
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.qty).toBeCloseTo(120)
    expect(rows[0]!.moving_cost).toBeCloseTo(2.0)
    const logs = ctx.inventoryService.listCostLogs(ctx.productId)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.source).toBe('purchase')
    expect(logs[0]!.source_id).toBe(doc.id)
  })

  it('create: transaction rolls back doc when inventory fails', () => {
    // 商品不存在 → applyChanges 抛错 → doc 也应回滚
    expect(() =>
      ctx.purchaseService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: 99999, qty: 1, price: 1 }]
      })
    ).toThrow()
    const r = ctx.purchaseService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(0)
  })

  it('batch product: inventory row carries batch_no', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.batchProductId, batch_no: 'B1', qty: 5, price: 20 }]
    })
    const rows = ctx.inventoryService.getByProduct(ctx.batchProductId, ctx.whId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.batch_no).toBe('B1')
    expect(rows[0]!.qty).toBeCloseTo(5)
  })

  it('rate default: omitting rate treats it as 1', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 3, price: 2 }]
    })
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows[0]!.qty).toBeCloseTo(3)
    expect(rows[0]!.moving_cost).toBeCloseTo(2)
  })

  it('supplier NOT_FOUND when nonexistent supplier_id', () => {
    expect(() =>
      ctx.purchaseService.create({
        supplier_id: 99999,
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 1, price: 1 }]
      })
    ).toThrowError(/供应商不存在/)
  })

  it('warehouse NOT_FOUND when bad warehouse_id', () => {
    expect(() =>
      ctx.purchaseService.create({
        warehouse_id: 99999,
        items: [{ product_id: ctx.productId, qty: 1, price: 1 }]
      })
    ).toThrowError(/仓库不存在/)
  })

  it('VALIDATION on empty items', () => {
    expect(() =>
      ctx.purchaseService.create({ warehouse_id: ctx.whId, items: [] })
    ).toThrowError(/明细/)
  })

  it('VALIDATION on qty <= 0 or price < 0', () => {
    expect(() =>
      ctx.purchaseService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 0, price: 1 }]
      })
    ).toThrowError(/数量/)
    expect(() =>
      ctx.purchaseService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 1, price: -1 }]
      })
    ).toThrowError(/单价/)
  })

  it('getDetail returns doc and items', () => {
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 2 }]
    })
    const detail = ctx.purchaseService.getDetail(doc.id)
    expect(detail.doc.id).toBe(doc.id)
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0]!.warehouse_id).toBe(ctx.whId)
  })

  it('query returns created doc', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 2 }]
    })
    const r = ctx.purchaseService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(1)
    expect(r.items[0]!.type).toBe('purchase')
    const r2 = ctx.purchaseService.query({
      page: 1,
      pageSize: 20,
      keyword: (r.items[0]!.no ?? '').slice(0, 8)
    })
    expect(r2.total).toBe(1)
  })
})
