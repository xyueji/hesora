import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { BizError } from '../../src/shared/result'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const fundService = createFundService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const retailService = createRetailService(db)
  const productId = productService.create({
    code: 'P001',
    name: '可乐',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none',
    units: [{ unit: '箱', rate: 12 }],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const accountId = fundService.create({ name: '现金', type: 'cash', opening_balance: 0 })
  return { retailService, purchaseService, inventoryService, productId, whId, accountId }
}

describe('retail.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  function stockUp(qty = 10, rate = 1, price = 2): void {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, rate, qty, price }]
    })
  }

  it('create after purchase: stock reduced by qty*rate, doc status done', () => {
    stockUp(10, 1, 2) // 库存 10
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 3, price: 3 }]
    })
    expect(doc.status).toBe('done')
    expect(doc.total_amount).toBeCloseTo(9)
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.qty).toBeCloseTo(7)
  })

  it('doc no starts with LS', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    expect(doc.no).toMatch(/^LS\d{8}\d{4}$/)
  })

  it('total = Σ qty*price (base unit)', () => {
    stockUp(24, 1, 2)
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [
        { product_id: ctx.productId, qty: 2, price: 3 },
        { product_id: ctx.productId, qty: 1, price: 5 }
      ]
    })
    expect(doc.total_amount).toBeCloseTo(11)
  })

  it('account_id must exist in fund_account', () => {
    stockUp()
    expect(() =>
      ctx.retailService.create({
        warehouse_id: ctx.whId,
        account_id: 99999,
        items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
      })
    ).toThrowError(/账户不存在/)
  })

  it('over-sell throws NOT_ENOUGH and doc rolled back', () => {
    stockUp(1, 1, 2) // 库存 1
    expect(() =>
      ctx.retailService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 5, price: 3 }]
      })
    ).toThrowError(/库存不足/)
    expect(() =>
      ctx.retailService.create({
        warehouse_id: ctx.whId,
        items: [{ product_id: ctx.productId, qty: 5, price: 3 }]
      })
    ).toThrowError(BizError)
    const r = ctx.retailService.query({ page: 1, pageSize: 20 })
    expect(r.total).toBe(0)
    const rows = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(rows[0]!.qty).toBeCloseTo(1)
  })

  it('散客 (no customer) ok: partner_id null', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    expect(doc.partner_id).toBeNull()
  })

  it('query filters by keyword and returns retail docs only', () => {
    stockUp()
    ctx.retailService.create({
      warehouse_id: ctx.whId,
      remark: '测试单',
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const all = ctx.retailService.query({ page: 1, pageSize: 20 })
    expect(all.total).toBe(1)
    const hit = ctx.retailService.query({ page: 1, pageSize: 20, keyword: 'LS' })
    expect(hit.total).toBe(1)
    const miss = ctx.retailService.query({ page: 1, pageSize: 20, keyword: 'ZZ9999' })
    expect(miss.total).toBe(0)
  })

  it('getDetail returns items; cross-type doc id throws NOT_FOUND', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const d = ctx.retailService.getDetail(doc.id)
    expect(d.doc.id).toBe(doc.id)
    expect(d.items).toHaveLength(1)
    // sale 单据 id 不可通过 retail 详情访问（这里用 purchase 的单据代替跨类型校验）
    const purchase = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 2 }]
    })
    expect(() => ctx.retailService.getDetail(purchase.id)).toThrowError(BizError)
  })
})
