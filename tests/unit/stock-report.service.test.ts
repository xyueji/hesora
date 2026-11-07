import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createStockReportService } from '../../src/main/services/inventory/stock-report.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'

function setup() {
  const db = openMemDb()
  const inv = createInventoryService(db)
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const whId2 = warehouseService.create({ name: '副仓', is_default: false })
  const coke = productService.create({
    code: 'P001',
    name: '可乐',
    spec: '330ml',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    min_stock: 10,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
  const sprite = productService.create({
    code: 'P002',
    name: '雪碧',
    base_unit: '瓶',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    min_stock: 5,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
  const tea = productService.create({
    code: 'P003',
    name: '绿茶',
    base_unit: '瓶',
    retail_price: 5,
    trade_price: 4,
    purchase_price: 3,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
  return { db, inv, productService, warehouseService, whId, whId2, coke, sprite, tea }
}

function insertDoc(
  db: ReturnType<typeof openMemDb>,
  no: string,
  type: string,
  date: string
): number {
  const r = db
    .prepare(
      "INSERT INTO doc (no, type, date, total_amount, status) VALUES (?, ?, ?, ?, 'done')"
    )
    .run(no, type, date, 100)
  return Number(r.lastInsertRowid)
}

function setCostLogDate(
  db: ReturnType<typeof openMemDb>,
  id: number,
  createdAt: string
): void {
  db.prepare('UPDATE cost_log SET created_at = ? WHERE id = ?').run(createdAt, id)
}

describe('stock-report.service statisticsDetail', () => {
  let ctx: ReturnType<typeof setup>
  let svc: ReturnType<typeof createStockReportService>
  beforeEach(() => {
    ctx = setup()
    svc = createStockReportService(ctx.db)
    ctx.inv.applyChanges([
      { product_id: ctx.coke, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 },
      { product_id: ctx.coke, warehouse_id: ctx.whId2, change_qty: 5, unit_cost: 2 },
      { product_id: ctx.sprite, warehouse_id: ctx.whId, batch_no: 'B1', change_qty: 4, unit_cost: 3 }
    ])
  })

  it('joins product/warehouse names and computes amount', () => {
    const r = svc.statisticsDetail({ page: 1, pageSize: 20 })
    expect(r.total).toBe(3)
    const coke = r.items.find((i) => i.warehouse_id === ctx.whId)!
    expect(coke.code).toBe('P001')
    expect(coke.name).toBe('可乐')
    expect(coke.spec).toBe('330ml')
    expect(coke.base_unit).toBe('罐')
    expect(coke.warehouse_name).toBe('主仓')
    expect(coke.qty).toBe(10)
    expect(coke.moving_cost).toBeCloseTo(2)
    expect(coke.amount).toBeCloseTo(20)
    const sprite = r.items.find((i) => i.product_id === ctx.sprite)!
    expect(sprite.batch_no).toBe('B1')
    expect(sprite.amount).toBeCloseTo(12)
  })

  it('returns totals for the whole filtered set', () => {
    const r = svc.statisticsDetail({ page: 1, pageSize: 1 })
    expect(r.items).toHaveLength(1)
    expect(r.total).toBe(3)
    expect(r.totals.qty).toBeCloseTo(19)
    expect(r.totals.amount).toBeCloseTo(42)
  })

  it('filters by keyword / product_id / warehouse_id', () => {
    expect(svc.statisticsDetail({ keyword: '可乐', page: 1, pageSize: 20 }).total).toBe(2)
    expect(
      svc.statisticsDetail({ product_id: ctx.sprite, page: 1, pageSize: 20 }).total
    ).toBe(1)
    expect(
      svc.statisticsDetail({ warehouse_id: ctx.whId2, page: 1, pageSize: 20 }).total
    ).toBe(1)
  })

  it('clamps page size into 1..200 and keeps deterministic order', () => {
    const r = svc.statisticsDetail({ page: 0, pageSize: 9999 })
    expect(r.items.length).toBeLessThanOrEqual(200)
    const first = svc.statisticsDetail({ page: 1, pageSize: 20 }).items
    const second = svc.statisticsDetail({ page: 1, pageSize: 20 }).items
    expect(first.map((x) => x.product_id)).toEqual(second.map((x) => x.product_id))
    expect(first[0]!.code).toBe('P001')
  })
})

describe('stock-report.service costChanges', () => {
  let ctx: ReturnType<typeof setup>
  let svc: ReturnType<typeof createStockReportService>
  beforeEach(() => {
    ctx = setup()
    svc = createStockReportService(ctx.db)
    const docId = insertDoc(ctx.db, 'CG20260101-001', 'purchase', '2026-01-01')
    ctx.inv.applyChanges([
      {
        product_id: ctx.coke,
        warehouse_id: ctx.whId,
        change_qty: 100,
        unit_cost: 2,
        source: 'purchase',
        source_id: docId
      },
      {
        product_id: ctx.coke,
        warehouse_id: ctx.whId,
        change_qty: -30,
        source: 'sale'
      }
    ])
    setCostLogDate(ctx.db, 1, '2026-01-05 10:00:00')
    setCostLogDate(ctx.db, 2, '2026-02-05 10:00:00')
  })

  it('joins doc.no for document sources and leaves blank otherwise', () => {
    const r = svc.costChanges({ page: 1, pageSize: 20 })
    expect(r.total).toBe(2)
    const purchase = r.items.find((i) => i.source === 'purchase')!
    expect(purchase.source_no).toBe('CG20260101-001')
    expect(purchase.source_label).toBe('采购单')
    expect(purchase.change_qty).toBe(100)
    expect(purchase.unit_cost).toBe(2)
    expect(purchase.change_amount).toBeCloseTo(200)
    expect(purchase.before_qty).toBe(0)
    expect(purchase.after_qty).toBe(100)
    expect(purchase.after_amount).toBeCloseTo(200)
    const sale = r.items.find((i) => i.source === 'sale')!
    expect(sale.source_no).toBe('')
    expect(sale.source_label).toBe('销售单')
    expect(sale.change_qty).toBe(-30)
    expect(sale.before_qty).toBe(100)
    expect(sale.after_qty).toBe(70)
  })

  it('filters by source', () => {
    const r = svc.costChanges({ source: 'purchase', page: 1, pageSize: 20 })
    expect(r.total).toBe(1)
    expect(r.items[0]!.source).toBe('purchase')
  })

  it('filters by date range and keyword', () => {
    const inFeb = svc.costChanges({ date_from: '2026-02-01', page: 1, pageSize: 20 })
    expect(inFeb.total).toBe(1)
    expect(inFeb.items[0]!.source).toBe('sale')
    const inJan = svc.costChanges({
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      page: 1,
      pageSize: 20
    })
    expect(inJan.total).toBe(1)
    expect(inJan.items[0]!.source).toBe('purchase')
    const byKeyword = svc.costChanges({ keyword: 'CG2026', page: 1, pageSize: 20 })
    expect(byKeyword.total).toBe(1)
    expect(byKeyword.items[0]!.source_no).toBe('CG20260101-001')
  })

  it('totals change qty and amount over the whole filtered set', () => {
    const r = svc.costChanges({ page: 1, pageSize: 1 })
    expect(r.items).toHaveLength(1)
    expect(r.total).toBe(2)
    expect(r.totals.change_qty).toBeCloseTo(70)
    expect(r.totals.change_amount).toBeCloseTo(140)
    expect(r.totals.count).toBe(2)
  })
})

describe('stock-report.service stockFlow', () => {
  let ctx: ReturnType<typeof setup>
  let svc: ReturnType<typeof createStockReportService>
  beforeEach(() => {
    ctx = setup()
    svc = createStockReportService(ctx.db)
    ctx.inv.applyChanges([
      { product_id: ctx.coke, warehouse_id: ctx.whId, change_qty: 100, unit_cost: 2, source: 'opening' },
      { product_id: ctx.coke, warehouse_id: ctx.whId, change_qty: -30, source: 'sale' },
      { product_id: ctx.coke, warehouse_id: ctx.whId, change_qty: 50, unit_cost: 4, source: 'purchase' }
    ])
    setCostLogDate(ctx.db, 1, '2026-01-01 09:00:00')
    setCostLogDate(ctx.db, 2, '2026-02-01 09:00:00')
    setCostLogDate(ctx.db, 3, '2026-03-01 09:00:00')
  })

  it('computes 期初 + 入库 - 出库 = 结存 for the given period', () => {
    const r = svc.stockFlow({
      date_from: '2026-02-01',
      date_to: '2026-03-31',
      product_id: ctx.coke
    })
    expect(r.items).toHaveLength(1)
    const row = r.items[0]!
    expect(row.code).toBe('P001')
    expect(row.open_qty).toBe(100)
    expect(row.open_amount).toBeCloseTo(200)
    expect(row.in_qty).toBe(50)
    expect(row.in_amount).toBeCloseTo(200)
    expect(row.out_qty).toBe(30)
    expect(row.out_amount).toBeCloseTo(60)
    expect(row.close_qty).toBeCloseTo(120)
    expect(row.close_amount).toBeCloseTo(340)
    expect(row.close_qty).toBeCloseTo(row.open_qty + row.in_qty - row.out_qty)
  })

  it('period without date_from counts the whole history as inflow', () => {
    const r = svc.stockFlow({ product_id: ctx.coke })
    const row = r.items[0]!
    expect(row.open_qty).toBe(0)
    expect(row.in_qty).toBe(150)
    expect(row.out_qty).toBe(30)
    expect(row.close_qty).toBeCloseTo(120)
  })

  it('filters by keyword and warehouse and returns totals', () => {
    const r = svc.stockFlow({ keyword: '可乐' })
    expect(r.items).toHaveLength(1)
    expect(r.totals.close_qty).toBeCloseTo(120)
    expect(r.totals.out_qty).toBe(30)
    const other = svc.stockFlow({ keyword: '雪碧' })
    expect(other.items).toHaveLength(0)
  })
})

describe('stock-report.service warnings', () => {
  let ctx: ReturnType<typeof setup>
  let svc: ReturnType<typeof createStockReportService>
  beforeEach(() => {
    ctx = setup()
    svc = createStockReportService(ctx.db)
    // 可乐：库存 5，预警值 10
    ctx.inv.applyChanges([
      { product_id: ctx.coke, warehouse_id: ctx.whId, change_qty: 5, unit_cost: 2 }
    ])
    // 雪碧：库存 0（预警值 5）
    ctx.inv.applyChanges([
      { product_id: ctx.sprite, warehouse_id: ctx.whId, change_qty: 10, unit_cost: 2 },
      { product_id: ctx.sprite, warehouse_id: ctx.whId, change_qty: -10 }
    ])
  })

  it('lists products at or below the warning value', () => {
    const r = svc.warnings({ page: 1, pageSize: 20 })
    const codes = r.items.map((i) => i.code)
    expect(codes).toContain('P001')
    expect(codes).toContain('P002')
    expect(codes).not.toContain('P003')
    const coke = r.items.find((i) => i.code === 'P001')!
    expect(coke.qty).toBe(5)
    expect(coke.min_stock).toBe(10)
    expect(coke.diff).toBe(5)
    expect(coke.status).toBe('低于预警值')
    const sprite = r.items.find((i) => i.code === 'P002')!
    expect(sprite.qty).toBe(0)
    expect(sprite.status).toBe('缺货')
  })

  it('supports warehouse scope and returns totals', () => {
    const r = svc.warnings({ warehouse_id: ctx.whId, page: 1, pageSize: 20 })
    expect(r.total).toBe(2)
    expect(r.totals.count).toBe(2)
    expect(r.totals.qty).toBe(5)
    expect(r.totals.diff).toBe(10)
  })

  it('setWarning updates product.min_stock and rejects bad input', () => {
    svc.setWarning(ctx.coke, 20)
    const p = ctx.productService.getById(ctx.coke)!
    expect(p.min_stock).toBe(20)
    expect(() => svc.setWarning(ctx.coke, -1)).toThrow(/预警值/)
    expect(() => svc.setWarning(999999, 5)).toThrow(/不存在/)
    expect(ctx.productService.getById(ctx.coke)!.min_stock).toBe(20)
  })

  it('setWarningsByCondition updates matched products only', () => {
    const r = svc.setWarningsByCondition({ keyword: '可乐' }, 50)
    expect(r.updated).toBe(1)
    expect(ctx.productService.getById(ctx.coke)!.min_stock).toBe(50)
    expect(ctx.productService.getById(ctx.sprite)!.min_stock).toBe(5)

    const r2 = svc.setWarningsByCondition({ min_stock: 50 }, 60)
    expect(r2.updated).toBe(1)
    expect(ctx.productService.getById(ctx.coke)!.min_stock).toBe(60)

    expect(() => svc.setWarningsByCondition({}, -2)).toThrow(/预警值/)
  })
})

describe('stock-report.service adjustPrices', () => {
  let ctx: ReturnType<typeof setup>
  let svc: ReturnType<typeof createStockReportService>
  beforeEach(() => {
    ctx = setup()
    svc = createStockReportService(ctx.db)
  })

  it('updates prices and writes price_adjust_log rows', () => {
    const r = svc.adjustPrices(
      [{ product_id: ctx.coke, retail_price: 3.5, trade_price: 2.6 }],
      '张三'
    )
    expect(r.updated).toBe(2)
    expect(r.products).toBe(1)
    expect(r.logs).toHaveLength(2)
    const p = ctx.productService.getById(ctx.coke)!
    expect(p.retail_price).toBeCloseTo(3.5)
    expect(p.trade_price).toBeCloseTo(2.6)
    expect(p.purchase_price).toBe(2)
    const retail = r.logs.find((l) => l.price_type === 'retail')!
    expect(retail.old_price).toBe(3)
    expect(retail.new_price).toBeCloseTo(3.5)
    expect(retail.operator).toBe('张三')
    const rows = ctx.db.prepare('SELECT * FROM price_adjust_log').all() as Array<{
      product_id: number
      price_type: string
      old_price: number
      new_price: number
    }>
    expect(rows).toHaveLength(2)
  })

  it('rejects an empty list', () => {
    expect(() => svc.adjustPrices([], '张三')).toThrow(/至少/)
  })

  it('rejects negative prices and keeps the product untouched', () => {
    expect(() =>
      svc.adjustPrices([{ product_id: ctx.coke, retail_price: -1 }], '张三')
    ).toThrow(/不能为负/)
    expect(ctx.productService.getById(ctx.coke)!.retail_price).toBe(3)
    const rows = ctx.db.prepare('SELECT * FROM price_adjust_log').all()
    expect(rows).toHaveLength(0)
  })

  it('rejects a missing product', () => {
    expect(() => svc.adjustPrices([{ product_id: 999999, retail_price: 3 }], '张三')).toThrow(
      /不存在/
    )
  })

  it('rolls back everything when one item is invalid', () => {
    expect(() =>
      svc.adjustPrices(
        [
          { product_id: ctx.coke, retail_price: 4 },
          { product_id: 999999, retail_price: 5 }
        ],
        '张三'
      )
    ).toThrow(/不存在/)
    expect(ctx.productService.getById(ctx.coke)!.retail_price).toBe(3)
    const rows = ctx.db.prepare('SELECT * FROM price_adjust_log').all()
    expect(rows).toHaveLength(0)
  })
})
