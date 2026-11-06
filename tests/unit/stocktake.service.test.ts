import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const stocktakeService = createStocktakeService(db)
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
  const whA = warehouseService.create({ name: '仓A', is_default: true })
  // 初始库存：100 @ 成本 2
  purchaseService.create({
    warehouse_id: whA,
    items: [{ product_id: productId, qty: 100, price: 2 }]
  })
  return { stocktakeService, purchaseService, inventoryService, productService, productId, whA }
}

describe('stocktake.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('盘盈: actual 120 → diff +20 IN at book cost 2, stock 120 cost 2, doc qty 20', () => {
    const doc = ctx.stocktakeService.create({
      warehouse_id: ctx.whA,
      items: [{ product_id: ctx.productId, actual_qty: 120 }]
    })
    expect(doc.no).toMatch(/^PD\d{8}\d{4}$/)
    const inv = ctx.inventoryService.getByProduct(ctx.productId, ctx.whA)
    expect(inv[0]!.qty).toBeCloseTo(120)
    expect(inv[0]!.moving_cost).toBeCloseTo(2)
    const detail = ctx.stocktakeService.getDetail(doc.id)
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0]!.qty).toBeCloseTo(20)
    expect(detail.items[0]!.price).toBeCloseTo(0)
  })

  it('盘亏: actual 70 → diff -30, stock 70', () => {
    const doc = ctx.stocktakeService.create({
      warehouse_id: ctx.whA,
      items: [{ product_id: ctx.productId, actual_qty: 70 }]
    })
    const inv = ctx.inventoryService.getByProduct(ctx.productId, ctx.whA)
    expect(inv[0]!.qty).toBeCloseTo(70)
    expect(inv[0]!.moving_cost).toBeCloseTo(2)
    const detail = ctx.stocktakeService.getDetail(doc.id)
    expect(detail.items[0]!.qty).toBeCloseTo(30)
  })

  it('无差异 (actual == book) throws VALIDATION 无差异', () => {
    expect(() =>
      ctx.stocktakeService.create({
        warehouse_id: ctx.whA,
        items: [{ product_id: ctx.productId, actual_qty: 100 }]
      })
    ).toThrowError(/无差异/)
  })

  it('无库存记录盘盈: new product actual 5 → stock 5 cost 0', () => {
    const p2 = ctx.productService.create({
      code: 'P002',
      name: '雪碧',
      base_unit: '瓶',
      retail_price: 3,
      trade_price: 2.5,
      purchase_price: 2,
      tracking_type: 'none',
      units: [],
      barcodes: []
    })
    ctx.stocktakeService.create({
      warehouse_id: ctx.whA,
      items: [{ product_id: p2, actual_qty: 5 }]
    })
    const inv = ctx.inventoryService.getByProduct(p2, ctx.whA)
    expect(inv[0]!.qty).toBeCloseTo(5)
    expect(inv[0]!.moving_cost).toBeCloseTo(0)
  })

  it('warehouse not found throws NOT_FOUND', () => {
    expect(() =>
      ctx.stocktakeService.create({
        warehouse_id: 99999,
        items: [{ product_id: ctx.productId, actual_qty: 1 }]
      })
    ).toThrowError(/仓库不存在/)
  })

  it('empty items throws VALIDATION', () => {
    expect(() =>
      ctx.stocktakeService.create({ warehouse_id: ctx.whA, items: [] })
    ).toThrowError(/盘点明细不能为空/)
  })

  it('negative actual_qty throws VALIDATION', () => {
    expect(() =>
      ctx.stocktakeService.create({
        warehouse_id: ctx.whA,
        items: [{ product_id: ctx.productId, actual_qty: -1 }]
      })
    ).toThrowError(/实盘数量/)
  })

  it('getSheet returns book rows with product info; keyword filters', () => {
    const sheet = ctx.stocktakeService.getSheet(ctx.whA)
    expect(sheet).toHaveLength(1)
    expect(sheet[0]!.product_code).toBe('P001')
    expect(sheet[0]!.product_name).toBe('可乐')
    expect(sheet[0]!.book_qty).toBeCloseTo(100)
    expect(sheet[0]!.moving_cost).toBeCloseTo(2)
    expect(sheet[0]!.unit).toBe('罐')
    const filtered = ctx.stocktakeService.getSheet(ctx.whA, '可乐')
    expect(filtered).toHaveLength(1)
    expect(ctx.stocktakeService.getSheet(ctx.whA, '雪碧')).toHaveLength(0)
  })

  it('query returns stocktake docs only', () => {
    ctx.stocktakeService.create({
      warehouse_id: ctx.whA,
      items: [{ product_id: ctx.productId, actual_qty: 90 }]
    })
    const r = ctx.stocktakeService.query({ page: 1, pageSize: 10 })
    expect(r.total).toBe(1)
    expect(r.items[0]!.type).toBe('stocktake')
  })
})
