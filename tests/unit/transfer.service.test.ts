import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createTransferService } from '../../src/main/services/transfer/transfer.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { BizError } from '../../src/shared/result'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const transferService = createTransferService(db)
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
    name: '牛奶',
    base_unit: '盒',
    retail_price: 5,
    trade_price: 4,
    purchase_price: 3,
    tracking_type: 'batch',
    units: [],
    barcodes: []
  })
  const whA = warehouseService.create({ name: '仓A', is_default: true })
  const whB = warehouseService.create({ name: '仓B', is_default: false })
  return { transferService, purchaseService, inventoryService, productService, productId, batchProductId, whA, whB }
}

describe('transfer.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  function stockUp(productId: number, whId: number, qty = 10, price = 2, batch_no?: string): void {
    ctx.purchaseService.create({
      warehouse_id: whId,
      items: [{ product_id: productId, qty, price, batch_no }]
    })
  }

  it('transfer 20 units A→B: A reduced, B increased with moving_cost = A cost', () => {
    stockUp(ctx.productId, ctx.whA, 30, 2)
    const doc = ctx.transferService.create({
      warehouse_id: ctx.whA,
      warehouse_in_id: ctx.whB,
      items: [{ product_id: ctx.productId, qty: 20 }]
    })
    expect(doc.status).toBe('done')
    expect(doc.warehouse_id).toBe(ctx.whA)
    expect(doc.warehouse_in_id).toBe(ctx.whB)
    const a = ctx.inventoryService.getByProduct(ctx.productId, ctx.whA)
    const b = ctx.inventoryService.getByProduct(ctx.productId, ctx.whB)
    expect(a[0]!.qty).toBeCloseTo(10)
    expect(b).toHaveLength(1)
    expect(b[0]!.qty).toBeCloseTo(20)
    expect(b[0]!.moving_cost).toBeCloseTo(2)
  })

  it('doc no starts with DB and total_amount is 0', () => {
    stockUp(ctx.productId, ctx.whA)
    const doc = ctx.transferService.create({
      warehouse_id: ctx.whA,
      warehouse_in_id: ctx.whB,
      items: [{ product_id: ctx.productId, qty: 1 }]
    })
    expect(doc.no).toMatch(/^DB\d{8}\d{4}$/)
    expect(doc.total_amount).toBeCloseTo(0)
  })

  it('same warehouse throws VALIDATION', () => {
    expect(() =>
      ctx.transferService.create({
        warehouse_id: ctx.whA,
        warehouse_in_id: ctx.whA,
        items: [{ product_id: ctx.productId, qty: 1 }]
      })
    ).toThrowError(BizError)
  })

  it('bad warehouse id throws NOT_FOUND', () => {
    stockUp(ctx.productId, ctx.whA)
    expect(() =>
      ctx.transferService.create({
        warehouse_id: ctx.whA,
        warehouse_in_id: 99999,
        items: [{ product_id: ctx.productId, qty: 1 }]
      })
    ).toThrowError(/仓库不存在/)
  })

  it('qty over stock throws NOT_ENOUGH and rolls back doc + inventory', () => {
    stockUp(ctx.productId, ctx.whA, 5, 2)
    expect(() =>
      ctx.transferService.create({
        warehouse_id: ctx.whA,
        warehouse_in_id: ctx.whB,
        items: [{ product_id: ctx.productId, qty: 20 }]
      })
    ).toThrowError(/库存不足/)
    const r = ctx.transferService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(0)
    const a = ctx.inventoryService.getByProduct(ctx.productId, ctx.whA)
    expect(a[0]!.qty).toBeCloseTo(5)
    expect(ctx.inventoryService.getByProduct(ctx.productId, ctx.whB)).toHaveLength(0)
  })

  it('batch product: transfers specific batch row', () => {
    stockUp(ctx.batchProductId, ctx.whA, 10, 3, 'B2024001')
    stockUp(ctx.batchProductId, ctx.whA, 8, 3.5, 'B2024002')
    const doc = ctx.transferService.create({
      warehouse_id: ctx.whA,
      warehouse_in_id: ctx.whB,
      items: [{ product_id: ctx.batchProductId, batch_no: 'B2024002', qty: 5 }]
    })
    expect(doc.id).toBeGreaterThan(0)
    const a2 = ctx.inventoryService.getByProduct(ctx.batchProductId, ctx.whA).find((r) => r.batch_no === 'B2024002')
    const b2 = ctx.inventoryService.getByProduct(ctx.batchProductId, ctx.whB)
    expect(a2!.qty).toBeCloseTo(3)
    expect(b2).toHaveLength(1)
    expect(b2[0]!.batch_no).toBe('B2024002')
    expect(b2[0]!.moving_cost).toBeCloseTo(3.5)
  })

  it('batch product without batch_no throws VALIDATION', () => {
    stockUp(ctx.batchProductId, ctx.whA, 10, 3, 'B2024001')
    expect(() =>
      ctx.transferService.create({
        warehouse_id: ctx.whA,
        warehouse_in_id: ctx.whB,
        items: [{ product_id: ctx.batchProductId, qty: 1 }]
      })
    ).toThrowError(/批次/)
  })

  it('unknown product throws NOT_FOUND', () => {
    expect(() =>
      ctx.transferService.create({
        warehouse_id: ctx.whA,
        warehouse_in_id: ctx.whB,
        items: [{ product_id: 99999, qty: 1 }]
      })
    ).toThrowError(/商品不存在/)
  })

  it('query filters and getDetail returns items', () => {
    stockUp(ctx.productId, ctx.whA)
    const doc = ctx.transferService.create({
      warehouse_id: ctx.whA,
      warehouse_in_id: ctx.whB,
      remark: '调拨',
      items: [{ product_id: ctx.productId, qty: 2 }]
    })
    const all = ctx.transferService.query({ page: 1, pageSize: 20 })
    expect(all.total).toBe(1)
    const hit = ctx.transferService.query({ page: 1, pageSize: 20, keyword: 'DB' })
    expect(hit.total).toBe(1)
    const miss = ctx.transferService.query({ page: 1, pageSize: 20, keyword: 'XS' })
    expect(miss.total).toBe(0)
    const d = ctx.transferService.getDetail(doc.id)
    expect(d.doc.id).toBe(doc.id)
    expect(d.items).toHaveLength(1)
    expect(d.items[0]!.qty).toBeCloseTo(2)
  })
})
