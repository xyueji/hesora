import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createSettingService } from '../../src/main/services/setting/setting.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createStockReportService } from '../../src/main/services/inventory/stock-report.service'
import type { Database } from 'better-sqlite3'

let db: Database
let products: ReturnType<typeof createProductService>
let settings: ReturnType<typeof createSettingService>
let inventory: ReturnType<typeof createInventoryService>
let stock: ReturnType<typeof createStockReportService>
let wid: number

function seedStockedProduct(over: Partial<Parameters<typeof products.create>[0]> = {}): number {
  return products.create({
    code: 'P1',
    name: '测试商品',
    base_unit: '个',
    tracking_type: 'none',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    ...over
  })
}

function stockUp(pid: number, qty: number): void {
  inventory.applyChanges([
    { product_id: pid, warehouse_id: wid, batch_no: '', change_qty: qty, unit_cost: 1, source: 'opening' }
  ])
}

beforeEach(() => {
  db = openMemDb()
  products = createProductService(db)
  settings = createSettingService(db)
  inventory = createInventoryService(db)
  stock = createStockReportService(db)
  const wrow = db.prepare("INSERT INTO warehouse (code, name) VALUES ('W1', '主仓') RETURNING id").get() as { id: number }
  wid = Number(wrow.id)
})

describe('P3-1 安全库存上限预警（超储）', () => {
  it('现库存超过 max_stock 时输出超储预警', () => {
    const pid = seedStockedProduct({ max_stock: 10 })
    stockUp(pid, 15)
    const page = stock.warnings({ page: 1, pageSize: 20 })
    const over = page.items.find((r) => r.warn_kind === 'over')
    expect(over).toBeDefined()
    expect(over!.product_id).toBe(pid)
    expect(over!.status).toBe('超储')
    expect(over!.max_stock).toBe(10)
    expect(over!.diff).toBe(5)
  })

  it('无上限（max_stock 为 null）不触发超储预警', () => {
    const pid = seedStockedProduct()
    stockUp(pid, 999)
    const page = stock.warnings({ page: 1, pageSize: 20 })
    expect(page.items.find((r) => r.warn_kind === 'over')).toBeUndefined()
  })

  it('低库存且设置上限时只出 low 预警，两种预警互不重复', () => {
    const pid = seedStockedProduct({ min_stock: 5, max_stock: 100 })
    stockUp(pid, 2)
    const page = stock.warnings({ page: 1, pageSize: 20 })
    const kinds = page.items.filter((r) => r.product_id === pid).map((r) => r.warn_kind)
    expect(kinds).toEqual(['low'])
  })
})

describe('P3-2 批号必录开关', () => {
  it('开关关闭时批次类商品可不带初始批次直接保存', () => {
    const id = products.create({ code: 'B1', name: '批次商品', base_unit: '个', tracking_type: 'batch', retail_price: 0, trade_price: 0, purchase_price: 0 })
    expect(id).toBeGreaterThan(0)
  })

  it('开关开启时批次类商品必须提供初始批次，否则拦截', () => {
    settings.set('product.batch_required', '1')
    expect(() =>
      products.create({ code: 'B2', name: '批次商品', base_unit: '个', tracking_type: 'batch', retail_price: 0, trade_price: 0, purchase_price: 0 })
    ).toThrow(/批号必录/)
    const id = products.create({
      code: 'B3',
      name: '批次商品',
      base_unit: '个',
      tracking_type: 'batch',
      retail_price: 0,
      trade_price: 0,
      purchase_price: 0,
      initial_batches: [{ batch_no: '20260101' }]
    })
    expect(id).toBeGreaterThan(0)
  })

  it('开关开启时非批次类商品不受影响；update 改为批次类同样拦截', () => {
    settings.set('product.batch_required', '1')
    const id = products.create({ code: 'S1', name: '普通商品', base_unit: '个', tracking_type: 'none', retail_price: 0, trade_price: 0, purchase_price: 0 })
    expect(id).toBeGreaterThan(0)
    expect(() => products.update(id, { tracking_type: 'batch' })).toThrow(/批号必录/)
  })
})

describe('P3-3 商品批量修改', () => {
  it('仅 patch 中填写的字段生效，未填字段保持原值', () => {
    const a = seedStockedProduct({ code: 'A1', retail_price: 10, min_stock: 1 })
    const b = seedStockedProduct({ code: 'A2', retail_price: 20, min_stock: 2 })
    const r = products.bulkUpdate([a, b], { retail_price: 99, shelf_no: 'A-01' })
    expect(r.updated).toBe(2)
    const pa = products.getById(a)!
    const pb = products.getById(b)!
    expect(pa.retail_price).toBe(99)
    expect(pb.retail_price).toBe(99)
    expect(pa.shelf_no).toBe('A-01')
    expect(pb.shelf_no).toBe('A-01')
    expect(pa.min_stock).toBe(1)
    expect(pb.min_stock).toBe(2)
  })

  it('空 ids / 空 patch / 非法数值抛 BizError', () => {
    expect(() => products.bulkUpdate([], { retail_price: 1 })).toThrow()
    expect(() => products.bulkUpdate([1], {})).toThrow(/至少填写一个/)
    expect(() => products.bulkUpdate([1], { retail_price: -5 })).toThrow()
    expect(() => products.bulkUpdate([0], { retail_price: 1 })).toThrow()
  })

  it('批量修改后写 platform_log（product.bulk_update，含 ids 与字段摘要）', () => {
    const a = seedStockedProduct({ code: 'L1' })
    products.bulkUpdate([a], { retail_price: 66, min_stock: 3 })
    const row = db
      .prepare("SELECT action, detail FROM platform_log WHERE action = 'product.bulk_update' ORDER BY id DESC LIMIT 1")
      .get() as { action: string; detail: string } | undefined
    expect(row).toBeDefined()
    expect(row!.detail).toContain(String(a))
    expect(row!.detail).toContain('retail_price')
  })
})

describe('P3 migration 060', () => {
  it('product 表含 max_stock / shelf_no 列', () => {
    const cols = (db.prepare('PRAGMA table_info(product)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('max_stock')
    expect(cols).toContain('shelf_no')
  })
})
