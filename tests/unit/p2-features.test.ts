// P2 功能批次：9 项 P2 功能的服务层测试
// 1 采购建议 purchaseSuggestions / 3 盘点复盘 review / 4 单号前缀可配 / 5 直过账审核位
// 6 商品自定义属性 / 7 打印模板设备绑定 / 9 操作日志抽查
import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createStockReportService } from '../../src/main/services/inventory/stock-report.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createProductAttributeService } from '../../src/main/services/product/product-attribute.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createSettingService } from '../../src/main/services/setting/setting.service'
import { createPrintTemplateService } from '../../src/main/services/print/template.service'
import { createAuditService } from '../../src/main/services/audit/audit.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'
import { BizError } from '../../src/shared/result'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const purchaseService = createPurchaseService(db)
  const inventoryService = createInventoryService(db)
  const whA = warehouseService.create({ name: '仓A', is_default: true })
  const whB = warehouseService.create({ name: '仓B', is_default: false })
  const pLow = productService.create({
    code: 'P001', name: '低库存商品', base_unit: '件', retail_price: 5, trade_price: 4,
    purchase_price: 2, tracking_type: 'none', min_stock: 50, barcodes: []
  })
  const pOk = productService.create({
    code: 'P002', name: '充足商品', base_unit: '件', retail_price: 5, trade_price: 4,
    purchase_price: 2, tracking_type: 'none', min_stock: 10, barcodes: []
  })
  const pNone = productService.create({
    code: 'P003', name: '无限线商品', base_unit: '件', retail_price: 5, trade_price: 4,
    purchase_price: 2, tracking_type: 'none', min_stock: 0, barcodes: []
  })
  purchaseService.create({
    warehouse_id: whA,
    items: [
      { product_id: pLow, qty: 20, price: 2 },
      { product_id: pOk, qty: 100, price: 2 },
      { product_id: pNone, qty: 5, price: 2 }
    ]
  })
  return {
    db, productService, warehouseService, purchaseService, inventoryService,
    stockReportService: createStockReportService(db),
    stocktakeService: createStocktakeService(db),
    docService: createDocService(db),
    settingService: createSettingService(db),
    templateService: createPrintTemplateService(db),
    auditService: createAuditService(db),
    attrService: createProductAttributeService(db),
    whA, whB, pLow, pOk, pNone
  }
}

let ctx: ReturnType<typeof setup>
beforeEach(() => {
  ctx = setup()
})

// ── 2. 采购建议 ──
describe('P2 #2 purchaseSuggestions', () => {
  it('lists only min_stock>0 with current<min, suggest_qty=min-current', () => {
    const list = ctx.stockReportService.purchaseSuggestions()
    expect(list.map((s) => s.product_id)).toEqual([ctx.pLow])
    const s = list[0]!
    expect(s).toMatchObject({ code: 'P001', min_stock: 50, current_qty: 20 })
    expect(s.suggest_qty).toBe(30)
  })

  it('filters by warehouse (B仓无库存 → 所有 min_stock>0 商品都建议)', () => {
    const list = ctx.stockReportService.purchaseSuggestions({ warehouse_id: ctx.whB })
    expect(list.map((s) => s.product_id).sort()).toEqual([ctx.pLow, ctx.pOk].sort())
  })

  it('rejects invalid warehouse_id', () => {
    expect(() => ctx.stockReportService.purchaseSuggestions({ warehouse_id: 1.5 })).toThrow(BizError)
  })
})

// ── 3. 盘点复盘 ──
describe('P2 #3 stocktake review', () => {
  it('review on done stocktake doc writes reviewer/time/remark, idempotent keeps latest', () => {
    const doc = ctx.stocktakeService.create({
      warehouse_id: ctx.whA,
      items: [{ product_id: ctx.pLow, actual_qty: 15 }]
    })
    expect(doc.status).toBe('done')
    const r1 = ctx.stocktakeService.review(doc.id, { review_by: '张三', review_remark: '第一次复盘' })
    expect(r1.review_by).toBe('张三')
    expect(r1.review_remark).toBe('第一次复盘')
    expect(r1.review_at).toBeTruthy()
    const at1 = r1.review_at ?? ''
    const r2 = ctx.stocktakeService.review(doc.id, { review_by: '李四' })
    expect(r2.review_by).toBe('李四')
    expect(r2.review_remark).toBeNull()
    expect((r2.review_at ?? '') >= at1).toBe(true)
  })

  it('rejects review for non-stocktake doc and missing doc', () => {
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whA, items: [{ product_id: ctx.pLow, qty: 1, price: 2 }]
    })
    expect(() => ctx.stocktakeService.review(doc.id, { review_by: 'x' })).toThrow(/盘点单不存在/)
    expect(() => ctx.stocktakeService.review(99999, { review_by: 'x' })).toThrow(/盘点单不存在/)
  })
})

// ── 4. 单号前缀可配 ──
describe('P2 #4 configurable doc number prefix', () => {
  it('new prefix applies to new docs; old doc numbers unchanged', () => {
    const old1 = ctx.purchaseService.create({
      warehouse_id: ctx.whA, items: [{ product_id: ctx.pLow, qty: 1, price: 2 }]
    })
    expect(old1.no).toMatch(/^CG\d{8}\d{4}$/)
    ctx.settingService.set('doc.no_prefix', JSON.stringify({ purchase: 'JH' }))
    const newDoc = ctx.purchaseService.create({
      warehouse_id: ctx.whA, items: [{ product_id: ctx.pLow, qty: 1, price: 2 }]
    })
    expect(newDoc.no).toMatch(/^JH\d{8}\d{4}$/)
    expect(ctx.docService.getById(old1.id)?.no).toBe(old1.no)
    // 未配置的类型仍用默认前缀
    const st = ctx.stocktakeService.create({
      warehouse_id: ctx.whA, items: [{ product_id: ctx.pLow, actual_qty: 21 }]
    })
    expect(st.no).toMatch(/^PD\d{8}\d{4}$/)
  })
})

// ── 5. 直过账单据审核位 ──
describe('P2 #5 doc review marker', () => {
  it('review marker persists and is idempotent; NOT_FOUND for missing doc', () => {
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whA, items: [{ product_id: ctx.pLow, qty: 1, price: 2 }]
    })
    expect(doc.reviewed_by).toBeNull()
    const r1 = ctx.docService.review(doc.id, { reviewer: '王审' })
    expect(r1.reviewed_by).toBe('王审')
    expect(r1.reviewed_at).toBeTruthy()
    const r2 = ctx.docService.review(doc.id, { reviewer: '李审' })
    expect(r2.reviewed_by).toBe('李审')
    expect(() => ctx.docService.review(424242, { reviewer: 'x' })).toThrow(/单据不存在/)
    // 库存不受审核影响（不回滚账务）：20(初始)+1(本单)+1(prefix测试后重开db前的累计不适用——本ctx内共2张单)
    expect(ctx.inventoryService.getByProduct(ctx.pLow, ctx.whA)[0]?.qty).toBeCloseTo(21)
  })
})

// ── 6. 商品自定义属性 ──
describe('P2 #6 product attributes', () => {
  it('attribute dictionary CRUD with option normalization and dup-name check', () => {
    const attr = ctx.attrService.create({ name: '颜色', options: ['红', '蓝', '红', ' '] })
    expect(JSON.parse(attr.options)).toEqual(['红', '蓝'])
    expect(() => ctx.attrService.create({ name: '颜色', options: [] })).toThrow(/已存在/)
    const updated = ctx.attrService.update(attr.id, { options: '["红","蓝","绿"]' })
    expect(JSON.parse(updated.options)).toEqual(['红', '蓝', '绿'])
    ctx.attrService.remove(attr.id)
    expect(() => ctx.attrService.getById(attr.id)).toThrow(/不存在/)
  })

  it('attribute in use by product cannot be removed', () => {
    const attr = ctx.attrService.create({ name: '尺码', options: ['S', 'M'] })
    ctx.productService.update(ctx.pLow, { attributes: { [String(attr.id)]: 'M' } })
    expect(() => ctx.attrService.remove(attr.id)).toThrow(/被 \d+ 个商品使用/)
  })

  it('product stores attributes; query filters by attr value', () => {
    const color = ctx.attrService.create({ name: '颜色', options: ['红', '蓝'] })
    ctx.productService.update(ctx.pLow, { attributes: { [String(color.id)]: '红' } })
    const got = ctx.productService.getById(ctx.pLow)
    expect(got?.attributes).toEqual({ [String(color.id)]: '红' })
    // 重新实例化服务验证持久化后的筛选（防止仅内存态命中）
    const svc = createProductService(ctx.db)
    const hit = svc.query({ page: 1, pageSize: 20, attr_filters: { [String(color.id)]: '红' } }).list
    expect(hit.map((p) => p.id)).toEqual([ctx.pLow])
    const miss = svc.query({ page: 1, pageSize: 20, attr_filters: { [String(color.id)]: '蓝' } }).list
    expect(miss).toHaveLength(0)
  })
})

// ── 7. 打印模板设备绑定 ──
describe('P2 #7 print template device binding', () => {
  it('save persists device_name (trim, empty→null)', () => {
    const id = ctx.templateService.save({ name: '小票A', kind: 'receipt', content: '{}', device_name: '  XP-58  ' })
    expect(ctx.templateService.list()[0]).toMatchObject({ id, device_name: 'XP-58' })
    ctx.templateService.save({ id, name: '小票A', kind: 'receipt', content: '{}', device_name: '   ' })
    expect(ctx.templateService.list()[0]?.device_name).toBeNull()
  })
})

// ── 9. 操作日志抽查 ──
describe('P2 #9 audit log spot checks', () => {
  it('records stocktake:create / stock:adjustPrices style actions via audit service', () => {
    const audit = ctx.auditService
    audit.record('stocktake:create', 'op1', '盘点单 PD1')
    audit.record('doc.review', 'op1', '补审核 CG1')
    audit.record('transfer:create', 'op1', '调拨 DB1')
    const rows = audit.list()
    const actions = rows.map((r) => r.action)
    expect(actions).toContain('stocktake:create')
    expect(actions).toContain('doc.review')
    expect(actions).toContain('transfer:create')
    expect(rows[0]?.operator).toBe('op1')
  })
})
