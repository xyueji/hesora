import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createAssembleService } from '../../src/main/services/assemble/assemble.service'
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
  const assembleService = createAssembleService(db)
  const wh = warehouseService.create({ name: '主仓', is_default: true })
  const productA = productService.create({
    code: 'A',
    name: '商品A',
    base_unit: '个',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    tracking_type: 'none'
  })
  const productB = productService.create({
    code: 'B',
    name: '商品B',
    base_unit: '个',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    tracking_type: 'none'
  })
  const comboC = productService.create({
    code: 'C',
    name: '组合C',
    base_unit: '套',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    tracking_type: 'none',
    kind: 'combo',
    bom: [
      { product_id: productA, qty: 2 },
      { product_id: productB, qty: 1 }
    ]
  })
  return { db, assembleService, purchaseService, inventoryService, productService, productA, productB, comboC, wh }
}

describe('assemble.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  function stockUp(productId: number, qty: number, price: number): void {
    ctx.purchaseService.create({
      warehouse_id: ctx.wh,
      items: [{ product_id: productId, qty, price }]
    })
  }

  // A: 100@2, B: 50@5
  function seed(): void {
    stockUp(ctx.productA, 100, 2)
    stockUp(ctx.productB, 50, 5)
  }

  it('assemble 10 C consumes bom children and costs 9.0 per combo', () => {
    seed()
    const doc = ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 10 })
    expect(doc.no).toMatch(/^ZZ\d{8}\d{4}$/)
    const a = ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)
    const b = ctx.inventoryService.getByProduct(ctx.productB, ctx.wh)
    const c = ctx.inventoryService.getByProduct(ctx.comboC, ctx.wh)
    expect(a[0]!.qty).toBeCloseTo(80)
    expect(b[0]!.qty).toBeCloseTo(40)
    expect(c).toHaveLength(1)
    expect(c[0]!.qty).toBeCloseTo(10)
    // (10*2*2 + 10*5) / 10 = 9.0
    expect(c[0]!.moving_cost).toBeCloseTo(9.0)
    // doc items: 2 children (positive consumed qty) + combo row last
    const d = ctx.assembleService.getDetail(doc.id)
    expect(d.items).toHaveLength(3)
    expect(d.items[2]!.product_id).toBe(ctx.comboC)
    expect(d.items[2]!.qty).toBeCloseTo(10)
    expect(d.items[2]!.price).toBeCloseTo(9.0)
    expect(d.items[0]!.product_id).toBe(ctx.productA)
    expect(d.items[0]!.qty).toBeCloseTo(20)
  })

  it('insufficient child stock throws NOT_ENOUGH and rolls back everything', () => {
    seed()
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 60 })
    ).toThrowError(/库存不足/)
    const r = ctx.assembleService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(0)
    // A needs 120 > 100 → rolled back
    expect(ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)[0]!.qty).toBeCloseTo(100)
    expect(ctx.inventoryService.getByProduct(ctx.comboC, ctx.wh)).toHaveLength(0)
  })

  it('unknown combo throws NOT_FOUND', () => {
    seed()
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: 99999, qty: 1 })
    ).toThrowError(BizError)
  })

  it('non-combo kind throws VALIDATION 组合商品不存在', () => {
    seed()
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.productA, qty: 1 })
    ).toThrowError(/组合商品不存在/)
  })

  it('qty <= 0 throws VALIDATION', () => {
    seed()
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 0 })
    ).toThrowError(/数量必须大于0/)
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: -1 })
    ).toThrowError(/数量必须大于0/)
  })

  it('unknown warehouse throws NOT_FOUND', () => {
    seed()
    expect(() =>
      ctx.assembleService.create({ warehouse_id: 99999, combo_id: ctx.comboC, qty: 1 })
    ).toThrowError(/仓库不存在/)
  })

  it('disassemble 5 C returns children at proportional cost summing to combo cost', () => {
    seed()
    ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 10 })
    const doc = ctx.assembleService.disassemble({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 5 })
    expect(doc.no).toMatch(/^CZ\d{8}\d{4}$/)
    const c = ctx.inventoryService.getByProduct(ctx.comboC, ctx.wh)[0]!
    expect(c.qty).toBeCloseTo(5)
    // combo moving_cost stays 9.0 (OUT doesn't change cost)
    expect(c.moving_cost).toBeCloseTo(9.0)
    const a = ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)[0]!
    const b = ctx.inventoryService.getByProduct(ctx.productB, ctx.wh)[0]!
    expect(a.qty).toBeCloseTo(90)
    expect(b.qty).toBeCloseTo(45)
    // doc item prices: 均摊单价 = 9/3 = 3.0；A 2件/套、B 1件/套；sum = 9.0 = combo cost
    const d = ctx.assembleService.getDisassembleDetail(doc.id)
    expect(d.items[0]!.product_id).toBe(ctx.comboC)
    expect(d.items[0]!.qty).toBeCloseTo(5)
    expect(d.items[0]!.price).toBeCloseTo(9.0)
    const aItem = d.items.find((i) => i.product_id === ctx.productA)!
    const bItem = d.items.find((i) => i.product_id === ctx.productB)!
    expect(aItem.qty).toBeCloseTo(10)
    expect(aItem.price).toBeCloseTo(3.0)
    expect(bItem.qty).toBeCloseTo(5)
    expect(bItem.price).toBeCloseTo(3.0)
    // 成本守恒：子件入库成本之和 = 组合商品出库成本
    expect(aItem.price * aItem.qty + bItem.price * bItem.qty).toBeCloseTo(45)
  })

  it('disassemble without combo stock throws NOT_ENOUGH and rolls back', () => {
    seed()
    expect(() =>
      ctx.assembleService.disassemble({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 1 })
    ).toThrowError(/库存不足/)
    expect(ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)[0]!.qty).toBeCloseTo(100)
  })

  it('query filters by type and keyword', () => {
    seed()
    ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 1 })
    ctx.assembleService.disassemble({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 1 })
    expect(ctx.assembleService.query({ page: 1, pageSize: 20 }).total).toBe(2)
    expect(ctx.assembleService.query({ page: 1, pageSize: 20, type: 'assemble' }).total).toBe(1)
    expect(ctx.assembleService.query({ page: 1, pageSize: 20, type: 'disassemble' }).total).toBe(1)
    expect(ctx.assembleService.query({ page: 1, pageSize: 20, keyword: 'ZZ' }).total).toBe(1)
  })

  it('T8 双审 M2: merged query paginates consistently across pages (total matches items across all pages)', () => {
    // 组装 2 张 + 拆卸 2 张 = 4 单（seed() 备足子件库存，拆卸回库不亏）
    seed()
    ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 2 })
    ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 2 })
    ctx.assembleService.disassemble({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 2 })
    ctx.assembleService.disassemble({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 2 })
    const p1 = ctx.assembleService.query({ page: 1, pageSize: 2 })
    const p2 = ctx.assembleService.query({ page: 2, pageSize: 2 })
    expect(p1.total).toBe(4)
    expect(p1.items).toHaveLength(2)
    expect(p2.items).toHaveLength(2)
    // 两页合并 = 全部单据，无重复无遗漏，id 降序
    const ids = [...p1.items.map((d) => d.id), ...p2.items.map((d) => d.id)]
    expect(new Set(ids).size).toBe(4)
    expect([...ids].sort((a, b) => b - a)).toEqual(ids)
  })
})

