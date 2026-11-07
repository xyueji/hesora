import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSerialService } from '../../src/main/services/inventory/serial.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const docService = createDocService(db)
  const serialService = createSerialService(db)
  const productId = productService.create({
    code: 'P-SN', name: '手机', base_unit: '台',
    retail_price: 3000, trade_price: 2800, purchase_price: 2500,
    tracking_type: 'serial', units: [], barcodes: []
  })
  const wh1 = warehouseService.create({ name: '主仓', is_default: true })
  const wh2 = warehouseService.create({ name: '分仓', is_default: false })
  return { db, serialService, docService, productId, wh1, wh2 }
}

describe('serial.service trace', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('输出完整事件链（入库单号/出库单号/时间/来源）与当前位置', () => {
    const purchase = ctx.docService.create({
      type: 'purchase', date: '2026-11-01', warehouse_id: ctx.wh1,
      items: [{ product_id: ctx.productId, qty: 1, price: 2500 }]
    })
    ctx.serialService.registerIn([
      { product_id: ctx.productId, warehouse_id: ctx.wh1, sn: 'SN-1', source: 'purchase', source_id: purchase.id }
    ])
    const sale = ctx.docService.create({
      type: 'sale', date: '2026-11-05', warehouse_id: ctx.wh1,
      items: [{ product_id: ctx.productId, qty: 1, price: 3000 }]
    })
    ctx.serialService.consumeOut([
      { product_id: ctx.productId, sn: 'SN-1', source: 'sale', source_id: sale.id }
    ])

    const t = ctx.serialService.trace('SN-1')
    expect(t.sn).toBe('SN-1')
    expect(t.current).toEqual({ status: 'out', warehouse_id: ctx.wh1 })
    expect(t.events).toHaveLength(2)
    const inEvent = t.events.find((e) => e.direction === 'in')!
    expect(inEvent.doc_no).toBe(purchase.no)
    expect(inEvent.doc_type).toBe('purchase')
    expect(inEvent.product_code).toBe('P-SN')
    const outEvent = t.events.find((e) => e.direction === 'out')!
    expect(outEvent.doc_no).toBe(sale.no)
    expect(outEvent.doc_type).toBe('sale')
  })

  it('未登记的序列号抛 BizError', () => {
    expect(() => ctx.serialService.trace('NOPE')).toThrow(/不存在/)
  })

  it('事件按时间正序排列（入库在前）', () => {
    const purchase = ctx.docService.create({
      type: 'purchase', date: '2026-11-01', warehouse_id: ctx.wh1,
      items: [{ product_id: ctx.productId, qty: 1, price: 2500 }]
    })
    ctx.serialService.registerIn([
      { product_id: ctx.productId, warehouse_id: ctx.wh1, sn: 'SN-2', source: 'purchase', source_id: purchase.id }
    ])
    const t = ctx.serialService.trace('SN-2')
    expect(t.current.status).toBe('in_stock')
    expect(t.events).toHaveLength(1)
    expect(t.events[0]!.direction).toBe('in')
  })
})
