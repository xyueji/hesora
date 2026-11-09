// S 级体验功能测试：热销榜 / 滞销商品 / 成本映射 / 商品导入更新策略
import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import type { Database } from 'better-sqlite3'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createStockReportService } from '../../src/main/services/inventory/stock-report.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createImportService } from '../../src/main/services/import/import.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { BizError } from '../../src/shared/result'

function seedBase(db: Database): void {
  db.exec(`
    INSERT INTO warehouse (id, code, name) VALUES (1, 'W1', '主仓');
    INSERT INTO warehouse (id, code, name) VALUES (2, 'W2', '次仓');
    INSERT INTO product (id, code, name, base_unit, retail_price) VALUES (1, 'PA', '商品A', '件', 10);
    INSERT INTO product (id, code, name, base_unit, retail_price) VALUES (2, 'PB', '商品B', '箱', 20);
    INSERT INTO product (id, code, name, base_unit, retail_price) VALUES (3, 'PC', '商品C', '个', 5);
    INSERT INTO customer (id, code, name) VALUES (1, 'C1', '客户1');
    INSERT INTO fund_account (id, code, name, type) VALUES (1, 'F1', '现金', 'cash');
  `)
}

describe('hotSale 热销榜（S 级）', () => {
  it('returns products sorted by sale qty over date range, forward 口径', () => {
    const db = openMemDb()
    seedBase(db)
    // 先入库（销售扣库存）
    createPurchaseService(db).create({ date: '2026-11-01', warehouse_id: 1, items: [
      { product_id: 1, qty: 10, price: 2 },
      { product_id: 2, qty: 10, price: 2 }
    ] })
    const sale = createSaleService(db)
    // 11-07：A 卖 3 件@10，B 卖 1 箱@20；11-08：A 再卖 2 件@10
    sale.create({ date: '2026-11-07', warehouse_id: 1, items: [
      { product_id: 1, qty: 3, price: 10 },
      { product_id: 2, qty: 1, price: 20 }
    ] })
    sale.create({ date: '2026-11-08', warehouse_id: 1, items: [
      { product_id: 1, qty: 2, price: 10 }
    ] })
    const reports = createReportService(db)
    const rows = reports.hotSale({ date_from: '2026-11-01', date_to: '2026-11-30' })
    expect(rows).toEqual([
      expect.objectContaining({ product_id: 1, code: 'PA', sale_qty: 5, sale_amount: 50 }),
      expect.objectContaining({ product_id: 2, code: 'PB', sale_qty: 1, sale_amount: 20 })
    ])
    // 日期过滤
    expect(reports.hotSale({ date_from: '2026-11-08', date_to: '2026-11-08' })).toEqual([
      expect.objectContaining({ product_id: 1, sale_qty: 2, sale_amount: 20 })
    ])
    // 仓库过滤
    expect(reports.hotSale({ date_from: '2026-11-01', date_to: '2026-11-30', warehouse_id: 2 })).toEqual([])
    // top 截断
    expect(reports.hotSale({ date_from: '2026-11-01', date_to: '2026-11-30', top: 1 })).toHaveLength(1)
    // 无效日期 → BizError
    expect(() => reports.hotSale({ date_from: 'bad', date_to: '2026-11-30' })).toThrow(BizError)
    db.close()
  })

  it('ignores draft docs and clamps top', () => {
    const db = openMemDb()
    seedBase(db)
    db.exec(
      "INSERT INTO doc (no, type, date, status, warehouse_id, total_amount) VALUES ('D1', 'sale', '2026-11-07', 'draft', 1, 999)"
    )
    const reports = createReportService(db)
    expect(reports.hotSale({ date_from: '2026-11-01', date_to: '2026-11-30' })).toEqual([])
    // top 非法值被钳制到 1（不抛错）——0 视同 1
    expect(reports.hotSale({ date_from: '2026-11-01', date_to: '2026-11-30', top: 0 })).toEqual([])
    db.close()
  })
})

describe('unsold 滞销商品（S 级）', () => {
  it('hits stocked-without-sales, misses sold products, respects day boundary', () => {
    const db = openMemDb()
    seedBase(db)
    // 入库：A、B、C 各 10 件（成本 2）
    createPurchaseService(db).create({ date: '2026-11-01', warehouse_id: 1, items: [
      { product_id: 1, qty: 10, price: 2 },
      { product_id: 2, qty: 10, price: 2 },
      { product_id: 3, qty: 10, price: 2 }
    ] })
    // A 刚刚卖出（近 1 天内）→ 不命中；B 30 天前卖出 → days=30 不命中、days=7 命中
    createSaleService(db).create({ date: '2026-11-09', warehouse_id: 1, items: [
      { product_id: 1, qty: 2, price: 10 }
    ] })
    db.exec(
      "UPDATE cost_log SET created_at = datetime('now','localtime','-40 days') WHERE product_id = 2 AND change_qty < 0"
    )
    const svc = createStockReportService(db)
    const all = svc.unsold({ days: 3650 })
    // C 无任何出库 → 命中；B 最近出库是 40 天前 → 命中；A 近期卖出 → 不命中
    const codes = all.map((r) => r.code).sort()
    expect(codes).toEqual(['PB', 'PC'])
    const c = all.find((r) => r.code === 'PC')!
    expect(c).toMatchObject({ product_id: 3, qty: 10, base_unit: '个' })
    expect(c.last_out).toBeNull()
    // 边界：days=7 时 B（40 天前出库）命中，A（今天出库）不命中
    const d7 = svc.unsold({ days: 7 }).map((r) => r.code)
    expect(d7).toContain('PB')
    expect(d7).not.toContain('PA')
    // 无仓库过滤参数时不报错、有库存的商品都在
    expect(svc.unsold({ days: 30 }).every((r) => r.qty > 0)).toBe(true)
    // 参数校验
    expect(() => svc.unsold({ days: 0 })).toThrow(BizError)
    expect(() => svc.unsold({ days: 4000 })).toThrow(BizError)
    db.close()
  })

  it('filters by warehouse', () => {
    const db = openMemDb()
    seedBase(db)
    createPurchaseService(db).create({ date: '2026-11-01', warehouse_id: 2, items: [
      { product_id: 3, qty: 5, price: 2 }
    ] })
    const svc = createStockReportService(db)
    expect(svc.unsold({ days: 30, warehouse_id: 2 }).map((r) => r.code)).toEqual(['PC'])
    expect(svc.unsold({ days: 30, warehouse_id: 1 })).toEqual([])
    db.close()
  })
})

describe('product costMap 成本映射（S 级）', () => {
  it('returns weighted average moving cost and omits stockless products', () => {
    const db = openMemDb()
    seedBase(db)
    // A：批次1 成本 2×10，批次2 成本 4×10 → 加权 3；B：成本 5×10 → 5；C 无库存 → 缺席
    createPurchaseService(db).create({ date: '2026-11-01', warehouse_id: 1, items: [
      { product_id: 1, qty: 10, price: 2 }
    ] })
    createPurchaseService(db).create({ date: '2026-11-02', warehouse_id: 1, items: [
      { product_id: 1, qty: 10, price: 4 },
      { product_id: 2, qty: 10, price: 5 }
    ] })
    const svc = createProductService(db)
    const map = svc.costMap()
    // moving_cost 以含税进价口径写入（允许极小浮点误差）
    expect(map[1]).toBeCloseTo(3, 6)
    expect(map[2]).toBeCloseTo(5, 6)
    expect(map[3]).toBeUndefined()
    // 按 ids 过滤
    const filtered = svc.costMap([2])
    expect(Object.keys(filtered)).toEqual(['2'])
    // 无库存 id 查询 → 空 map
    expect(svc.costMap([3])).toEqual({})
    db.close()
  })
})

describe('importProducts 更新策略（S 级）', () => {
  const HEADER = '编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码\n'
  function setup(): { db: Database; svc: ReturnType<typeof createImportService> } {
    const db = openMemDb()
    createProductService(db).create({
      code: 'P001', name: '旧名称', base_unit: '罐',
      retail_price: 1, trade_price: 1, purchase_price: 1,
      tracking_type: 'none', units: [], barcodes: []
    })
    return { db, svc: createImportService(db) }
  }

  it('mixed rows: successes persist, failures collected with row numbers', () => {
    const { db, svc } = setup()
    const csv = HEADER
      + 'P100,新商品,,,个,5,4,3,,无\n'
      + ',缺编码,,,个,1,1,1,,无\n'
      + 'P200,,,件,1,2,3,,无\n' // 名称空 → 失败
    const r = svc.importProducts(csv, 'update')
    expect(r.created).toBe(1)
    expect(r.updated).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.errors).toEqual([
      { row: 3, message: '编码不能为空' },
      { row: 4, message: '名称不能为空' }
    ])
    expect(createProductService(db).getById(2)?.code).toBe('P100')
  })

  it("mode 'update' overwrites mutable fields, never the code", () => {
    const { db, svc } = setup()
    const r = svc.importProducts(HEADER + 'P001,新名称,,,瓶,9.9,8,7,3,批次,\n', 'update')
    expect(r.updated).toBe(1)
    expect(r.created).toBe(0)
    const p = createProductService(db).getById(1)!
    expect(p.name).toBe('新名称')
    expect(p.base_unit).toBe('瓶')
    expect(p.retail_price).toBe(9.9)
    expect(p.code).toBe('P001')
    expect(p.tracking_type).toBe('batch')
  })

  it("mode 'skip' leaves existing products untouched and counts skipped", () => {
    const { db, svc } = setup()
    const r = svc.importProducts(HEADER + 'P001,改名,,,瓶,9.9,8,7,,无\nP002,新品,,,个,2,2,2,,无\n', 'skip')
    expect(r.skipped).toBe(1)
    expect(r.created).toBe(1)
    expect(r.updated).toBe(0)
    const p = createProductService(db).getById(1)!
    // 跳过：原字段保持不变
    expect(p.name).toBe('旧名称')
    expect(p.retail_price).toBe(1)
    expect(p.base_unit).toBe('罐')
    expect(createProductService(db).getById(2)?.code).toBe('P002')
    // 默认 mode = 'update'（兼容既有行为）
    const r2 = svc.importProducts(HEADER + 'P001,再次改名,,,瓶,9.9,8,7,,无\n')
    expect(r2.updated).toBe(1)
    expect(createProductService(db).getById(1)?.name).toBe('再次改名')
  })
})
