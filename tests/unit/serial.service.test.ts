import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSerialService } from '../../src/main/services/inventory/serial.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import type { DB } from '../../src/main/services/doc/doc.service'
import { BizError } from '../../src/shared/result'

interface SerialNumberRow {
  id: number
  sn: string
  product_id: number
  warehouse_id: number
  batch_no: string
  status: string
  in_qty: number
  out_qty: number
  in_date: string
  out_date: string | null
  in_source: string | null
  in_source_id: number | null
  out_source: string | null
  out_source_id: number | null
}

interface SerialFlowRow {
  id: number
  sn: string
  product_id: number
  doc_id: number | null
  doc_item_id: number | null
  direction: string
  qty: number
  created_at: string
}

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const docService = createDocService(db)
  const serialService = createSerialService(db)
  const serialProductId = productService.create({
    code: 'P-SN-001',
    name: '智能手机',
    base_unit: '台',
    retail_price: 3000,
    trade_price: 2800,
    purchase_price: 2500,
    tracking_type: 'serial',
    units: [],
    barcodes: []
  })
  const normalProductId = productService.create({
    code: 'P-002',
    name: '可乐',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  return { db, serialService, docService, serialProductId, normalProductId, whId }
}

describe('serial.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('registerIn: 序列号落库为 in_stock 并写一条入库流水', () => {
    const res = ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    expect(res.count).toBe(1)
    const row = ctx.db
      .prepare('SELECT * FROM serial_number WHERE sn = ?')
      .get('SN-A001') as SerialNumberRow | undefined
    expect(row).toBeTruthy()
    expect(row!.status).toBe('in_stock')
    expect(row!.in_qty).toBe(1)
    expect(row!.out_qty).toBe(0)
    expect(row!.warehouse_id).toBe(ctx.whId)
    const flows = ctx.db
      .prepare('SELECT * FROM serial_flow WHERE sn = ? ORDER BY id')
      .all('SN-A001') as SerialFlowRow[]
    expect(flows).toHaveLength(1)
    expect(flows[0]!.direction).toBe('in')
    expect(flows[0]!.qty).toBe(1)
  })

  it('registerIn: 同一商品的序列号不可重复登记', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    expect(() =>
      ctx.serialService.registerIn([
        { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
      ])
    ).toThrowError(BizError)
    try {
      ctx.serialService.registerIn([
        { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
      ])
    } catch (e) {
      const err = e as BizError
      expect(err.code).toBe('VALIDATION')
      expect(err.message).toContain('序列号已存在')
      expect(err.message).toContain('SN-A001')
    }
  })

  it('registerIn: 非序列号商品不允许登记序列号', () => {
    expect(() =>
      ctx.serialService.registerIn([
        { product_id: ctx.normalProductId, warehouse_id: ctx.whId, sn: 'SN-B001' }
      ])
    ).toThrowError(/该商品未启用序列号/)
  })

  it('registerIn: 仓库不存在时拒绝登记', () => {
    expect(() =>
      ctx.serialService.registerIn([
        { product_id: ctx.serialProductId, warehouse_id: 999999, sn: 'SN-C001' }
      ])
    ).toThrowError(/仓库不存在/)
  })

  it('registerIn: 空列表被拒绝', () => {
    expect(() => ctx.serialService.registerIn([])).toThrowError(/不能为空/)
  })

  it('registerIn: 一条序列号非法时整批回滚', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    expect(() =>
      ctx.serialService.registerIn([
        { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-D001' },
        { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
      ])
    ).toThrowError(BizError)
    const row = ctx.db
      .prepare('SELECT * FROM serial_number WHERE sn = ?')
      .get('SN-D001') as SerialNumberRow | undefined
    expect(row).toBeUndefined()
    const flows = ctx.db
      .prepare('SELECT * FROM serial_flow WHERE sn = ?')
      .all('SN-D001') as SerialFlowRow[]
    expect(flows).toHaveLength(0)
  })

  it('consumeOut: 核销后序列号变为 out 并写出一条库流水', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    const res = ctx.serialService.consumeOut([
      { product_id: ctx.serialProductId, sn: 'SN-A001', source: 'sale', source_id: 7 }
    ])
    expect(res.count).toBe(1)
    const row = ctx.db
      .prepare('SELECT * FROM serial_number WHERE sn = ?')
      .get('SN-A001') as SerialNumberRow
    expect(row.status).toBe('out')
    expect(row.out_qty).toBe(1)
    expect(row.out_date).toBeTruthy()
    expect(row.out_source).toBe('sale')
    expect(row.out_source_id).toBe(7)
    const flows = ctx.db
      .prepare('SELECT * FROM serial_flow WHERE sn = ? ORDER BY id')
      .all('SN-A001') as SerialFlowRow[]
    expect(flows).toHaveLength(2)
    expect(flows[1]!.direction).toBe('out')
    expect(flows[1]!.doc_id).toBe(7)
  })

  it('consumeOut: 已出库的序列号不可再次出库', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-A001' }])
    expect(() =>
      ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-A001' }])
    ).toThrowError(/序列号不存在或已出库/)
  })

  it('consumeOut: 不存在的序列号被拒绝', () => {
    expect(() =>
      ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-NONE' }])
    ).toThrowError(/序列号不存在或已出库/)
  })

  it('consumeOut: 数量必须大于 0', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    expect(() =>
      ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-A001', qty: 0 }])
    ).toThrowError(/数量必须大于0/)
  })

  it('consumeOut: 部分核销时序列号仍在库', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001', qty: 3 }
    ])
    ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-A001', qty: 1 }])
    const row = ctx.db
      .prepare('SELECT * FROM serial_number WHERE sn = ?')
      .get('SN-A001') as SerialNumberRow
    expect(row.status).toBe('in_stock')
    expect(row.out_qty).toBe(1)
    expect(ctx.serialService.stockOf(ctx.serialProductId)).toBe(1)
  })

  it('listStock: 关联商品、仓库与来源单据号', () => {
    const doc = ctx.docService.create({
      type: 'purchase',
      date: '2026-11-07',
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.serialProductId, qty: 1, price: 2500 }]
    })
    ctx.serialService.registerIn([
      {
        product_id: ctx.serialProductId,
        warehouse_id: ctx.whId,
        sn: 'SN-A001',
        source: 'purchase',
        source_id: doc.id
      }
    ])
    const page = ctx.serialService.listStock({
      keyword: 'SN-A001',
      page: 1,
      pageSize: 20
    })
    expect(page.total).toBe(1)
    const item = page.items[0]!
    expect(item.sn).toBe('SN-A001')
    expect(item.product_code).toBe('P-SN-001')
    expect(item.product_name).toBe('智能手机')
    expect(item.warehouse_name).toBe('主仓')
    expect(item.status).toBe('in_stock')
    expect(item.in_source_no).toBe(doc.no)
    expect(item.out_source_no).toBeNull()
  })

  it('listStock: 按状态与商品过滤', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A002' }
    ])
    ctx.serialService.consumeOut([{ product_id: ctx.serialProductId, sn: 'SN-A002' }])
    const inStock = ctx.serialService.listStock({
      product_id: ctx.serialProductId,
      status: 'in_stock',
      page: 1,
      pageSize: 20
    })
    expect(inStock.total).toBe(1)
    expect(inStock.items[0]!.sn).toBe('SN-A001')
    const outStock = ctx.serialService.listStock({
      product_id: ctx.serialProductId,
      status: 'out',
      page: 1,
      pageSize: 20
    })
    expect(outStock.total).toBe(1)
    expect(outStock.items[0]!.sn).toBe('SN-A002')
  })

  it('listFlow: 返回序列号流向（出入库单据号）', () => {
    const inDoc = ctx.docService.create({
      type: 'purchase',
      date: '2026-11-07',
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.serialProductId, qty: 1, price: 2500 }]
    })
    const outDoc = ctx.docService.create({
      type: 'sale',
      date: '2026-11-07',
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.serialProductId, qty: 1, price: 3000 }]
    })
    ctx.serialService.registerIn([
      {
        product_id: ctx.serialProductId,
        warehouse_id: ctx.whId,
        sn: 'SN-A001',
        source: 'purchase',
        source_id: inDoc.id
      }
    ])
    ctx.serialService.consumeOut([
      { product_id: ctx.serialProductId, sn: 'SN-A001', source: 'sale', source_id: outDoc.id }
    ])
    const page = ctx.serialService.listFlow({ sn: 'SN-A001', page: 1, pageSize: 20 })
    expect(page.total).toBe(2)
    // 流水按 id 倒序（最新在前）
    expect(page.items[0]!.direction).toBe('out')
    expect(page.items[0]!.doc_no).toBe(outDoc.no)
    expect(page.items[1]!.direction).toBe('in')
    expect(page.items[1]!.doc_no).toBe(inDoc.no)
    expect(page.items[0]!.product_code).toBe('P-SN-001')
  })

  it('validateSns: 入库前报出台账中已存在的序列号', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    const dup = ctx.serialService.validateSns(ctx.serialProductId, ['SN-A001', 'SN-NEW'], 'in')
    expect(dup.ok).toBe(false)
    expect(dup.duplicates).toContain('SN-A001')
    expect(dup.unknown).toHaveLength(0)

    const fresh = ctx.serialService.validateSns(ctx.serialProductId, ['SN-NEW'], 'in')
    expect(fresh.ok).toBe(true)
    expect(fresh.duplicates).toHaveLength(0)
    expect(fresh.unknown).toHaveLength(0)
  })

  it('validateSns: 出库前报出不在库的序列号', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    const missing = ctx.serialService.validateSns(
      ctx.serialProductId,
      ['SN-A001', 'SN-NOT-EXIST'],
      'out'
    )
    expect(missing.ok).toBe(false)
    expect(missing.unknown).toContain('SN-NOT-EXIST')
    expect(missing.duplicates).toHaveLength(0)
  })

  it('validateSns: 同一列表内重复录入的序列号会被报出', () => {
    const res = ctx.serialService.validateSns(ctx.serialProductId, ['SN-X', 'SN-X'], 'out')
    expect(res.ok).toBe(false)
    expect(res.duplicates).toContain('SN-X')
  })

  it('stockOf: 统计在库序列号数量', () => {
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A001' }
    ])
    ctx.serialService.registerIn([
      { product_id: ctx.serialProductId, warehouse_id: ctx.whId, sn: 'SN-A002' }
    ])
    expect(ctx.serialService.stockOf(ctx.serialProductId)).toBe(2)
  })
})
