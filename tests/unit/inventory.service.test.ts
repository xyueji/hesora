import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'

function setup() {
  const db = openMemDb()
  const inv = createInventoryService(db)
  const productId = createProductService(db).create({ code: 'P001', name: '可乐', base_unit: '罐', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [], barcodes: [] })
  const whId = createWarehouseService(db).create({ name: '主仓', is_default: true })
  const whId2 = createWarehouseService(db).create({ name: '副仓', is_default: false })
  return { db, inv, productId, whId, whId2 }
}

describe('inventory.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('IN sets qty and moving_cost', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 2, source: 'opening' }])
    const r = ctx.inv.getByProduct(ctx.productId, ctx.whId)
    expect(r[0]!.qty).toBe(100)
    expect(r[0]!.moving_cost).toBe(2)
  })

  it('mixed IN recomputes weighted average (100@2 + 100@3 → 2.5)', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 2 }])
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 3 }])
    const r = ctx.inv.getByProduct(ctx.productId, ctx.whId)
    expect(r[0]!.qty).toBe(200)
    expect(r[0]!.moving_cost).toBeCloseTo(2.5)
  })

  it('OUT deducts at moving_cost and protects negative qty', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 2 }])
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: -30, source: 'sale' }])
    let r = ctx.inv.getByProduct(ctx.productId, ctx.whId)
    expect(r[0]!.qty).toBe(70)
    expect(r[0]!.moving_cost).toBeCloseTo(2)
    expect(() => ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: -100 }])).toThrow()
  })

  it('cost_log records after_qty and after_cost', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 2, source: 'opening' }])
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: -30, source: 'sale' }])
    const logs = ctx.inv.listCostLogs(ctx.productId)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs).toHaveLength(2)
    expect(logs[1]!.after_qty).toBe(70)
    expect(logs[1]!.after_cost).toBeCloseTo(2)
    expect(logs[1]!.source).toBe('sale')
  })

  it('batch_no separates lots in same warehouse', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, batch_no: 'B2025A', change_qty: 10, unit_cost: 5 }])
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, batch_no: 'B2025B', change_qty: 20, unit_cost: 8 }])
    const r = ctx.inv.getByProduct(ctx.productId, ctx.whId)
    expect(r).toHaveLength(2)
    const a = r.find((x) => x.batch_no === 'B2025A')
    const b = r.find((x) => x.batch_no === 'B2025B')
    expect(a!.qty).toBe(10); expect(a!.moving_cost).toBe(5)
    expect(b!.qty).toBe(20); expect(b!.moving_cost).toBe(8)
  })

  it('applyChanges is all-or-nothing (second change fails → first rolled back)', () => {
    expect(() =>
      ctx.inv.applyChanges([
        { product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 },
        { product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: -999 }
      ])
    ).toThrow()
    const r = ctx.inv.getByProduct(ctx.productId, ctx.whId)
    expect(r).toHaveLength(0)
  })
})

describe('inventory.service queryStock', () => {
  let ctx: ReturnType<typeof setup>
  let productService: ReturnType<typeof createProductService>
  beforeEach(() => {
    ctx = setup()
    productService = createProductService(ctx.db)
  })

  it('returns joined product/warehouse info with amount computed', () => {
    const p2 = productService.create({ code: 'P002', name: '雪碧', base_unit: '瓶', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [{ unit: '箱', rate: 24 }], barcodes: [] })
    ctx.inv.applyChanges([
      { product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 },
      { product_id: p2, warehouse_id: ctx.whId2, change_qty: 5, unit_cost: 3 }
    ])
    const r = ctx.inv.queryStock({ page: 1, pageSize: 10 })
    expect(r.total).toBe(2)
    const coke = r.items.find((i) => i.product_code === 'P001')!
    expect(coke.product_name).toBe('可乐')
    expect(coke.warehouse_name).toBe('主仓')
    expect(coke.qty).toBe(10)
    expect(coke.moving_cost).toBeCloseTo(2)
    expect(coke.amount).toBeCloseTo(20)
    expect(coke.unit).toBe('罐')
    const sprite = r.items.find((i) => i.product_code === 'P002')!
    expect(sprite.spec).toBe('箱=24')
    expect(sprite.amount).toBeCloseTo(15)
  })

  it('keyword filter only returns matching product rows', () => {
    const p2 = productService.create({ code: 'P002', name: '雪碧', base_unit: '瓶', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [], barcodes: [] })
    ctx.inv.applyChanges([
      { product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 },
      { product_id: p2, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 }
    ])
    const r = ctx.inv.queryStock({ keyword: '可乐', page: 1, pageSize: 10 })
    expect(r.total).toBe(1)
    expect(r.items[0]!.product_code).toBe('P001')
  })

  it('excludes zero-qty rows', () => {
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 }])
    ctx.inv.applyChanges([{ product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: -10 }])
    const r = ctx.inv.queryStock({ page: 1, pageSize: 10 })
    expect(r.total).toBe(0)
    expect(r.items).toHaveLength(0)
  })

  it('paginates: page 1 has pageSize items, total counts all', () => {
    const p2 = productService.create({ code: 'P002', name: '雪碧', base_unit: '瓶', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [], barcodes: [] })
    const p3 = productService.create({ code: 'P003', name: '芬达', base_unit: '瓶', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [], barcodes: [] })
    ctx.inv.applyChanges([
      { product_id: ctx.productId, warehouse_id: ctx.whId, change_qty: 1, unit_cost: 2 },
      { product_id: p2, warehouse_id: ctx.whId, change_qty: 1, unit_cost: 2 },
      { product_id: p3, warehouse_id: ctx.whId, change_qty: 1, unit_cost: 2 }
    ])
    const r = ctx.inv.queryStock({ page: 1, pageSize: 2 })
    expect(r.items).toHaveLength(2)
    expect(r.total).toBe(3)
    const r2 = ctx.inv.queryStock({ page: 2, pageSize: 2 })
    expect(r2.items).toHaveLength(1)
  })
})
