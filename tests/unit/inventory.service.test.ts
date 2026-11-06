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
  return { db, inv, productId, whId }
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
