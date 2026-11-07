import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const purchaseService = createPurchaseService(db)
  const inventoryService = createInventoryService(db)
  const stocktakeService = createStocktakeService(db)
  const p1 = productService.create({
    code: 'P001', name: '可乐', base_unit: '罐',
    retail_price: 3, trade_price: 2.5, purchase_price: 2,
    tracking_type: 'none', units: [], barcodes: []
  })
  const p2 = productService.create({
    code: 'P002', name: '雪碧', base_unit: '罐',
    retail_price: 3, trade_price: 2.5, purchase_price: 2,
    tracking_type: 'none', units: [], barcodes: []
  })
  const wh = warehouseService.create({ name: '主仓', is_default: true })
  purchaseService.create({
    warehouse_id: wh,
    items: [{ product_id: p1, qty: 100, price: 2 }, { product_id: p2, qty: 50, price: 2 }]
  })
  return { db, productService, stocktakeService, inventoryService, p1, p2, wh }
}

describe('stocktake.service importSheet', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('全部有效：返回 draft 概要与 diff，不自动过账', () => {
    const res = ctx.stocktakeService.importSheet(
      '商品编码,实盘数量\nP001,80\nP002,60\n',
      { warehouse_id: ctx.wh }
    )
    expect(res.errors).toEqual([])
    expect(res.rows).toHaveLength(2)
    const r1 = res.rows.find((r) => r.product_code === 'P001')!
    expect(r1.product_id).toBe(ctx.p1)
    expect(r1.book_qty).toBe(100)
    expect(r1.actual_qty).toBe(80)
    expect(r1.diff).toBe(-20)
    const r2 = res.rows.find((r) => r.product_code === 'P002')!
    expect(r2.diff).toBe(10)
    // 不自动过账：库存未变，未生成 stocktake 单据
    const inv = ctx.inventoryService.getByProduct(ctx.p1, ctx.wh)
    expect(inv[0]!.qty).toBe(100)
    const docs = ctx.db.prepare("SELECT COUNT(*) AS c FROM doc WHERE type='stocktake'").get() as { c: number }
    expect(docs.c).toBe(0)
    // draft 可直接用于 create
    const doc = ctx.stocktakeService.create({
      warehouse_id: ctx.wh,
      items: res.rows.map((r) => ({ product_id: r.product_id, batch_no: r.batch_no, actual_qty: r.actual_qty }))
    })
    expect(doc.type).toBe('stocktake')
  })

  it('部分行无效：收集错误行继续，不生成草稿', () => {
    const res = ctx.stocktakeService.importSheet(
      '商品编码,实盘数量\nP001,80\nNOPE,10\nP002,abc\n,5\nP001,-1\n',
      { warehouse_id: ctx.wh }
    )
    expect(res.rows).toHaveLength(1)
    expect(res.errors).toHaveLength(4)
    expect(res.errors.map((e) => e.row).sort((a, b) => a - b)).toEqual([2, 3, 4, 5])
    expect(res.errors.some((e) => e.message.includes('NOPE'))).toBe(true)
    expect(res.errors.some((e) => e.message.includes('实盘数量'))).toBe(true)
  })

  it('支持可选批次号列与自定义日期', () => {
    const res = ctx.stocktakeService.importSheet(
      '商品编码,实盘数量,批次号\nP001,80,B1\n',
      { warehouse_id: ctx.wh, date: '2026-11-01' }
    )
    expect(res.errors).toEqual([])
    expect(res.rows[0]!.batch_no).toBe('B1')
  })

  it('仓库不存在抛 BizError；空表抛 BizError', () => {
    expect(() => ctx.stocktakeService.importSheet('商品编码,实盘数量\nP001,80\n', { warehouse_id: 999 }))
      .toThrow(/仓库不存在/)
    expect(() => ctx.stocktakeService.importSheet('', { warehouse_id: ctx.wh })).toThrow()
  })
})
