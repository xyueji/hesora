import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createReportService } from '../../src/main/services/stats/report.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'
import { BizError } from '../../src/shared/result'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const docService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const productId = productService.create({
    code: 'P001', name: '可乐', base_unit: '罐',
    retail_price: 3, trade_price: 2.5, purchase_price: 2,
    tracking_type: 'none', units: [], barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  // 成本：移动加权 2
  inventoryService.applyChanges([
    { product_id: productId, warehouse_id: whId, batch_no: '', change_qty: 100, unit_cost: 2, source: 'opening' }
  ])
  const reportService = createReportService(db)
  return { db, productId, whId, docService, reportService }
}

describe('report.service operatorPerformance', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('按业务员汇总销售额/退货额/单数/毛利', () => {
    ctx.docService.create({
      type: 'sale', date: '2026-11-01', warehouse_id: ctx.whId, operator: 'alice',
      items: [{ product_id: ctx.productId, qty: 10, price: 5 }]
    })
    ctx.docService.create({
      type: 'retail', date: '2026-11-02', warehouse_id: ctx.whId, operator: 'alice',
      items: [{ product_id: ctx.productId, qty: 5, price: 3 }]
    })
    ctx.docService.create({
      type: 'sale_return', date: '2026-11-03', warehouse_id: ctx.whId, operator: 'bob',
      items: [{ product_id: ctx.productId, qty: 2, price: 5 }]
    })
    // 无业务员单据
    ctx.docService.create({
      type: 'sale', date: '2026-11-04', warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 6 }]
    })

    const rows = ctx.reportService.operatorPerformance({})
    expect(rows).toHaveLength(3)
    const alice = rows.find((r) => r.operator === 'alice')!
    expect(alice.sales_amount).toBeCloseTo(10 * 5 + 5 * 3)
    expect(alice.return_amount).toBe(0)
    expect(alice.doc_count).toBe(2)
    // 毛利 = amount - qty*rate*moving_cost(=2)：65 - 15*2 = 35
    expect(alice.gross_profit).toBeCloseTo(35)
    const bob = rows.find((r) => r.operator === 'bob')!
    expect(bob.sales_amount).toBe(0)
    expect(bob.return_amount).toBeCloseTo(10)
    expect(bob.doc_count).toBe(1)
    const none = rows.find((r) => r.operator === null)!
    expect(none.sales_amount).toBeCloseTo(6)
    expect(none.doc_count).toBe(1)
  })

  it('支持日期区间与业务员关键字过滤', () => {
    ctx.docService.create({
      type: 'sale', date: '2026-11-01', warehouse_id: ctx.whId, operator: 'alice',
      items: [{ product_id: ctx.productId, qty: 1, price: 10 }]
    })
    ctx.docService.create({
      type: 'sale', date: '2026-10-01', warehouse_id: ctx.whId, operator: 'alice',
      items: [{ product_id: ctx.productId, qty: 1, price: 10 }]
    })
    ctx.docService.create({
      type: 'sale', date: '2026-11-02', warehouse_id: ctx.whId, operator: 'bob',
      items: [{ product_id: ctx.productId, qty: 1, price: 10 }]
    })
    const rows = ctx.reportService.operatorPerformance({ date_from: '2026-11-01', date_to: '2026-11-30' })
    expect(rows.map((r) => r.operator).sort()).toEqual(['alice', 'bob'])
    const alice = ctx.reportService.operatorPerformance({ operator: 'ali' })
    expect(alice).toHaveLength(1)
    expect(alice[0]!.operator).toBe('alice')
  })

  it('日期格式非法抛 BizError', () => {
    expect(() => ctx.reportService.operatorPerformance({ date_from: 'bad' })).toThrow(BizError)
  })
})
