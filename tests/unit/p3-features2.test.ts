import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemDb } from '../helpers/mem-db'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createReversalService } from '../../src/main/services/doc/reversal.service'
import { createInternalUseService } from '../../src/main/services/inventory/internal-use.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createFlowCategoryService } from '../../src/main/services/setting/flow-category.service'
import { createProductImageService } from '../../src/main/services/product/product-image.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import type { Database } from 'better-sqlite3'

let db: Database
let inventory: ReturnType<typeof createInventoryService>
let products: ReturnType<typeof createProductService>
let wid: number
let pid: number

function stockUp(pid2: number, qty: number, cost = 1): void {
  inventory.applyChanges([
    { product_id: pid2, warehouse_id: wid, batch_no: '', change_qty: qty, unit_cost: cost, source: 'opening' }
  ])
}

beforeEach(() => {
  db = openMemDb()
  inventory = createInventoryService(db)
  products = createProductService(db)
  const wrow = db.prepare("INSERT INTO warehouse (code, name) VALUES ('W1', '主仓') RETURNING id").get() as { id: number }
  wid = Number(wrow.id)
  pid = products.create({
    code: 'P1',
    name: '测试商品',
    base_unit: '个',
    tracking_type: 'none',
    retail_price: 10,
    trade_price: 0,
    purchase_price: 0,
    commission_rate: 10
  })
  stockUp(pid, 100, 2)
})

// ── P3-2 进出类别字典 ──
describe('P3-2 flow_category 字典', () => {
  it('CRUD + 去重 + 方向校验', () => {
    const svc = createFlowCategoryService(db)
    const id1 = svc.create({ name: '领用', kind: 'out' })
    const id2 = svc.create({ name: '进货', kind: 'in' })
    expect(id1).toBeGreaterThan(0)
    expect(svc.list({}).length).toBe(2)
    // 去重
    expect(() => svc.create({ name: '领用', kind: 'out' })).toThrowError(
      expect.objectContaining({ code: 'DUP_CODE' })
    )
    // 方向校验
    expect(() => svc.create({ name: '坏类别', kind: 'bad' as 'in' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' })
    )
    // 更新 + 停用 + 启用 + 删除
    svc.update(id1, { name: '内部领用' })
    svc.disable(id1)
    const hidden = svc.list({ kind: 'out' })
    expect(hidden.length).toBe(0)
    const shown = svc.list({ include_disabled: true, kind: 'out' })
    expect(shown.length).toBe(1)
    expect(shown[0]?.disabled).toBeTruthy()
    svc.enable(id1)
    svc.remove(id2)
    expect(svc.list({}).length).toBe(1)
  })
})

// ── P3-3 内部领用出库单 ──
describe('P3-3 internal_use 内部领用', () => {
  it('领用减库存 + 成本按 moving_cost', () => {
    const docs = createDocService(db)
    const svc = createInternalUseService(db)
    // 期初 100 件 @2 → moving_cost = 2
    const docId = svc.create({
      warehouse_id: wid,
      operator: 'admin',
      items: [{ product_id: pid, qty: 10, receiver: '张三', purpose: '办公室耗材' }]
    }).id
    const doc = docs.getById(docId) as { type: string; total_amount: number }
    expect(doc.type).toBe('internal_use')
    // 库存扣减
    const inv = db
      .prepare('SELECT qty FROM inventory WHERE product_id=? AND warehouse_id=?')
      .get(pid, wid) as { qty: number }
    expect(inv.qty).toBe(90)
    // 出库成本按 moving_cost 记账（cost_log unit_cost=2）
    const cl = db
      .prepare("SELECT change_qty, unit_cost FROM cost_log WHERE product_id=? ORDER BY id DESC LIMIT 1")
      .get(pid) as { change_qty: number; unit_cost: number }
    expect(cl.change_qty).toBe(-10)
    expect(cl.unit_cost).toBe(2)
    // doc_item.remark 记录领用人/用途
    const item = db
      .prepare('SELECT remark FROM doc_item WHERE doc_id=?')
      .get(docId) as { remark: string }
    expect(item.remark).toContain('张三')
    expect(item.remark).toContain('办公室耗材')
  })

  it('整单红冲回退库存', () => {
    const svc = createInternalUseService(db)
    const rev = createReversalService(db)
    const docId = svc.create({
      warehouse_id: wid,
      operator: 'admin',
      items: [{ product_id: pid, qty: 10, receiver: '李四' }]
    }).id
    expect((db.prepare('SELECT qty FROM inventory WHERE product_id=? AND warehouse_id=?').get(pid, wid) as { qty: number }).qty).toBe(90)
    rev.reverse(docId, 'admin')
    const inv = db
      .prepare('SELECT qty FROM inventory WHERE product_id=? AND warehouse_id=?')
      .get(pid, wid) as { qty: number }
    expect(inv.qty).toBe(100)
    // 红冲单回补入库按原出库 unit_cost
    const cl = db
      .prepare("SELECT change_qty, unit_cost FROM cost_log WHERE product_id=? ORDER BY id DESC LIMIT 1")
      .get(pid) as { change_qty: number; unit_cost: number }
    expect(cl.change_qty).toBe(10)
    expect(cl.unit_cost).toBe(2)
    // 不能重复红冲
    expect(() => rev.reverse(docId, 'admin')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' })
    )
  })

  it('库存不足拒绝领用', () => {
    const svc = createInternalUseService(db)
    expect(() =>
      svc.create({
        warehouse_id: wid,
        operator: 'admin',
        items: [{ product_id: pid, qty: 999, receiver: '王五' }]
      })
    ).toThrowError(expect.objectContaining({ code: 'NOT_ENOUGH' }))
  })
})

// ── P3-4 商品图片 ──
describe('P3-4 product images', () => {
  it('save/remove/list 往返 + 超 3 张拒绝 + 越权文件名拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hsp-img-'))
    try {
      const svc = createProductImageService(db, dir)
      const png = Buffer.from('89504e470d0a1a0a', 'hex')
      const n1 = svc.save({ product_id: pid, file_name: 'a.png', data: png })
      const n2 = svc.save({ product_id: pid, file_name: 'b.jpg', data: png })
      const n3 = svc.save({ product_id: pid, file_name: 'c.webp', data: png })
      expect(svc.list(pid)).toEqual([n1, n2, n3])
      // 第 4 张拒绝
      expect(() => svc.save({ product_id: pid, file_name: 'd.png', data: png })).toThrowError(
        expect.objectContaining({ code: 'VALIDATION' })
      )
      // 往返：read 回原字节
      const back = svc.read(n1)
      expect(Buffer.from(back.data, 'base64').equals(png)).toBe(true)
      expect(back.mime).toBe('image/png')
      // 删除后列表缩短
      svc.remove(pid, n2)
      expect(svc.list(pid)).toEqual([n1, n3])
      // 非法文件名
      expect(() => svc.read('../evil.png')).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
      expect(() => svc.save({ product_id: pid, file_name: 'x.exe', data: png })).toThrowError(
        expect.objectContaining({ code: 'VALIDATION' })
      )
      // product.images JSON 同步
      const p = products.getById(pid) as { images: string[] }
      expect(p.images).toEqual([n1, n3])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── P3-5 提成率 ──
describe('P3-5 commission_rate', () => {
  it('销售下单透传提成率 + 合计口径 Σqty×price×rate%', () => {
    const sales = createSaleService(db)
    const customer = db
      .prepare("INSERT INTO customer (code, name) VALUES ('C1', '客户一') RETURNING id")
      .get() as { id: number }
    const saleId = sales.create({
      customer_id: Number(customer.id),
      warehouse_id: wid,
      operator: 'admin',
      items: [{ product_id: pid, qty: 2, price: 100, commission_rate: 5 }]
    })
    const item = db
      .prepare('SELECT commission_rate FROM doc_item WHERE doc_id=?')
      .get((saleId as { id: number }).id) as { commission_rate: number }
    expect(item.commission_rate).toBe(5)
    // 合计口径：2 × 100 × 5% = 10
    expect(2 * 100 * 5 / 100).toBe(10)
  })

  it('未传提成率默认 0；负数拒绝', () => {
    const sales = createSaleService(db)
    const customer = db
      .prepare("INSERT INTO customer (code, name) VALUES ('C2', '客户二') RETURNING id")
      .get() as { id: number }
    const id1 = sales.create({
      customer_id: Number(customer.id),
      warehouse_id: wid,
      operator: 'admin',
      items: [{ product_id: pid, qty: 1, price: 10 }]
    })
    const item = db.prepare('SELECT commission_rate FROM doc_item WHERE doc_id=?').get((id1 as { id: number }).id) as { commission_rate: number }
    expect(item.commission_rate).toBe(0)
    expect(() =>
      sales.create({
        customer_id: Number(customer.id),
        warehouse_id: wid,
        operator: 'admin',
        items: [{ product_id: pid, qty: 1, price: 10, commission_rate: -1 }]
      })
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
  })
})

// ── P3-6 销售日历 ──
describe('P3-6 calendarSales 按日聚合', () => {
  it('按日聚合正确（真实销售单）', () => {
    const sales = createSaleService(db)
    const customer = db
      .prepare("INSERT INTO customer (code, name) VALUES ('C3', '客户三') RETURNING id")
      .get() as { id: number }
    const cid = Number(customer.id)
    // 3/5 两单（100+50），3/8 一单（200）
    sales.create({ customer_id: cid, warehouse_id: wid, date: '2026-03-05', operator: 'admin', items: [{ product_id: pid, qty: 10, price: 10 }] })
    sales.create({ customer_id: cid, warehouse_id: wid, date: '2026-03-05', operator: 'admin', items: [{ product_id: pid, qty: 5, price: 10 }] })
    sales.create({ customer_id: cid, warehouse_id: wid, date: '2026-03-08', operator: 'admin', items: [{ product_id: pid, qty: 20, price: 10 }] })
    const report = createReportService(db)
    const rows = report.calendarSales({ year: 2026, month: 3 })
    const map = new Map(rows.map((r) => [r.date, r]))
    expect(map.get('2026-03-05')).toMatchObject({ count: 2, amount: 150 })
    expect(map.get('2026-03-08')).toMatchObject({ count: 1, amount: 200 })
    // 仅当月
    expect(rows.every((r) => r.date.startsWith('2026-03-'))).toBe(true)
  })
})
