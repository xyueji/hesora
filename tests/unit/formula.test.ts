import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createFormulaService } from '../../src/main/services/product/formula.service'
import { createAssembleService } from '../../src/main/services/assemble/assemble.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const assembleService = createAssembleService(db)
  const saleService = createSaleService(db)
  const formulaService = createFormulaService(db)
  const wh = warehouseService.create({ name: '主仓', is_default: true })
  const productA = productService.create({
    code: 'A', name: '商品A', base_unit: '个', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'none'
  })
  const productB = productService.create({
    code: 'B', name: '商品B', base_unit: '个', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'none'
  })
  const comboC = productService.create({
    code: 'C', name: '组合C', base_unit: '套', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'none',
    kind: 'combo',
    bom: [
      { product_id: productA, qty: 2 },
      { product_id: productB, qty: 1 }
    ]
  })
  return { db, formulaService, assembleService, saleService, productService, inventoryService, purchaseService, productA, productB, comboC, wh }
}

describe('formula.service（独立配方档案）', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('create/list 往返，含子件数量', () => {
    const id = ctx.formulaService.create({
      name: '配方C',
      output_product_id: ctx.comboC,
      output_qty: 2,
      items: [
        { product_id: ctx.productA, qty: 4 },
        { product_id: ctx.productB, qty: 2 }
      ]
    })
    const rows = ctx.formulaService.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id, name: '配方C', output_product_id: ctx.comboC, output_qty: 2, disabled: 0 })
    expect(rows[0]!.items).toHaveLength(2)
  })

  it('校验：items 空 VALIDATION、qty<=0 VALIDATION、产出商品不存在 NOT_FOUND、重名 DUP_CODE', () => {
    expect(() => ctx.formulaService.create({ name: 'X', output_product_id: ctx.comboC, items: [] })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' })
    )
    expect(() =>
      ctx.formulaService.create({
        name: 'X', output_product_id: ctx.comboC, output_qty: 0, items: [{ product_id: ctx.productA, qty: 1 }]
      })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
    expect(() =>
      ctx.formulaService.create({ name: 'X', output_product_id: 9999, items: [{ product_id: ctx.productA, qty: 1 }] })
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
    ctx.formulaService.create({ name: '配方', output_product_id: ctx.comboC, items: [{ product_id: ctx.productA, qty: 1 }] })
    expect(() =>
      ctx.formulaService.create({ name: '配方', output_product_id: ctx.comboC, items: [{ product_id: ctx.productA, qty: 1 }] })
    ).toThrowError(expect.objectContaining({ code: 'DUP_CODE' }))
  })

  it('update 整体替换子表；remove 物理删除；disable/enable', () => {
    const id = ctx.formulaService.create({
      name: '配方1', output_product_id: ctx.comboC, items: [{ product_id: ctx.productA, qty: 1 }]
    })
    ctx.formulaService.update(id, {
      name: '配方1改',
      output_qty: 3,
      items: [{ product_id: ctx.productB, qty: 5 }]
    })
    const row = ctx.formulaService.getById(id)!
    expect(row.name).toBe('配方1改')
    expect(row.output_qty).toBe(3)
    expect(row.items).toEqual([expect.objectContaining({ product_id: ctx.productB, qty: 5 })])
    ctx.formulaService.disable(id)
    expect(ctx.formulaService.getById(id)!.disabled).toBe(1)
    expect(ctx.formulaService.list({ include_disabled: false })).toHaveLength(0)
    ctx.formulaService.enable(id)
    expect(ctx.formulaService.list({ include_disabled: false })).toHaveLength(1)
    ctx.formulaService.remove(id)
    expect(ctx.formulaService.getById(id)).toBeNull()
    expect(() => ctx.formulaService.update(id, { name: 'x' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )
  })

  it('disable 后配方不可用于组装（VALIDATION）', () => {
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productA, qty: 100, price: 2 }] })
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productB, qty: 50, price: 5 }] })
    const fid = ctx.formulaService.create({
      name: '配方D', output_product_id: ctx.comboC, output_qty: 1,
      items: [{ product_id: ctx.productA, qty: 1 }, { product_id: ctx.productB, qty: 1 }]
    })
    ctx.formulaService.disable(fid)
    expect(() =>
      ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 1, formula_id: fid })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
  })

  it('assemble 指定配方：按 output_qty 折算子件用量（每单位组合用量=qty/output_qty）', () => {
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productA, qty: 100, price: 2 }] })
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productB, qty: 50, price: 5 }] })
    // 配方：产出 2 套 C，需 A×1、B×3 → 每套 C 用 A 0.5、B 1.5（与 BOM 2/1 不同，验证走配方）
    const fid = ctx.formulaService.create({
      name: '配方E', output_product_id: ctx.comboC, output_qty: 2,
      items: [{ product_id: ctx.productA, qty: 1 }, { product_id: ctx.productB, qty: 3 }]
    })
    ctx.assembleService.create({ warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 4, formula_id: fid })
    const a = ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)
    const b = ctx.inventoryService.getByProduct(ctx.productB, ctx.wh)
    const c = ctx.inventoryService.getByProduct(ctx.comboC, ctx.wh)
    expect(a[0]!.qty).toBeCloseTo(98) // 100 - 4*0.5
    expect(b[0]!.qty).toBeCloseTo(44) // 50 - 4*1.5
    expect(c[0]!.qty).toBeCloseTo(4)
    // 组合成本 = (4*0.5*2 + 4*1.5*5)/4 = 0.5*2 + 1.5*5 = 8.5
    expect(c[0]!.moving_cost).toBeCloseTo(8.5)
    // 产出商品与组合不一致 → VALIDATION
    expect(() =>
      ctx.assembleService.create({
        warehouse_id: ctx.wh, combo_id: ctx.comboC, qty: 1,
        formula_id: ctx.formulaService.create({
          name: '配方F', output_product_id: ctx.productA, items: [{ product_id: ctx.productB, qty: 1 }]
        })
      })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
  })

  it('combo 销售自动拆解：扣子件库存、combo 不出库、成本走子件 moving_cost', () => {
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productA, qty: 100, price: 2 }] })
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productB, qty: 50, price: 5 }] })
    const doc = ctx.saleService.create({
      warehouse_id: ctx.wh,
      items: [{ product_id: ctx.comboC, qty: 3, price: 30 }]
    })
    expect(doc.type).toBe('sale')
    const a = ctx.inventoryService.getByProduct(ctx.productA, ctx.wh)
    const b = ctx.inventoryService.getByProduct(ctx.productB, ctx.wh)
    expect(a[0]!.qty).toBeCloseTo(94) // 100 - 3*2
    expect(b[0]!.qty).toBeCloseTo(47) // 50 - 3*1
    // combo 不出库：无 combo 库存行
    expect(ctx.inventoryService.getByProduct(ctx.comboC, ctx.wh)).toHaveLength(0)
    // doc_item 保留 combo 行
    const items = ctx.db.prepare('SELECT product_id, qty, amount FROM doc_item WHERE doc_id = ?').all(doc.id) as Array<{ product_id: number; qty: number; amount: number }>
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ product_id: ctx.comboC, qty: 3, amount: 90 })
    // cost_log source='sale' 挂在子件上，unit_cost = 子件 moving_cost
    const logs = ctx.db.prepare(
      "SELECT product_id, change_qty, unit_cost FROM cost_log WHERE source = 'sale' AND source_id = ?"
    ).all(doc.id) as Array<{ product_id: number; change_qty: number; unit_cost: number }>
    expect(logs).toHaveLength(2)
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ product_id: ctx.productA, change_qty: -6, unit_cost: 2 }),
      expect.objectContaining({ product_id: ctx.productB, change_qty: -3, unit_cost: 5 })
    ]))
    // 毛利 = 售价 90 − 子件成本 (6*2 + 3*5) = 90 − 27 = 63（与 report profit 口径一致）
    expect(90 - logs.reduce((s, l) => s + -l.change_qty * l.unit_cost, 0)).toBeCloseTo(63)
  })

  it('combo 销售子件库存不足抛 NOT_ENOUGH 且指明子件名', () => {
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productA, qty: 5, price: 2 }] })
    ctx.purchaseService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.productB, qty: 1, price: 5 }] })
    // 需 A×6、B×3 → A、B 均不足
    expect(() =>
      ctx.saleService.create({ warehouse_id: ctx.wh, items: [{ product_id: ctx.comboC, qty: 3, price: 30 }] })
    ).toThrowError(
      expect.objectContaining({ code: 'NOT_ENOUGH', message: expect.stringContaining('商品A') })
    )
    // 不足时单据一并回滚
    expect(ctx.db.prepare("SELECT COUNT(*) AS c FROM doc WHERE type = 'sale'").get() as { c: number }).toMatchObject({ c: 0 })
  })

  it('批次子件需批次号；序列号子件不支持拆解销售', () => {
    const batchChild = ctx.productService.create({
      code: 'BA', name: '批次A', base_unit: '个', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'batch'
    })
    const comboBatch = ctx.productService.create({
      code: 'CB', name: '组合批次', base_unit: '套', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'none',
      kind: 'combo', bom: [{ product_id: batchChild, qty: 1 }]
    })
    expect(() =>
      ctx.saleService.create({ warehouse_id: ctx.wh, items: [{ product_id: comboBatch, qty: 1, price: 1 }] })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION', message: expect.stringContaining('批次') }))

    const serialChild = ctx.productService.create({
      code: 'SA', name: '序列A', base_unit: '个', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'serial'
    })
    const comboSerial = ctx.productService.create({
      code: 'CS', name: '组合序列', base_unit: '套', retail_price: 0, trade_price: 0, purchase_price: 0, tracking_type: 'none',
      kind: 'combo', bom: [{ product_id: serialChild, qty: 1 }]
    })
    expect(() =>
      ctx.saleService.create({ warehouse_id: ctx.wh, items: [{ product_id: comboSerial, qty: 1, price: 1 }] })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION', message: expect.stringContaining('序列号') }))
  })
})
