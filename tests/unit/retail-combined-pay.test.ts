import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
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
    units: [],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const cashId = fundService.create({ name: '现金', type: 'cash', opening_balance: 0 })
  const wechatId = fundService.create({ name: '微信', type: 'cash', opening_balance: 0 })
  return { db, retailService, purchaseService, inventoryService, productService, productId, whId, cashId, wechatId }
}

describe('retail combined payment & discount', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  function stockUp(qty = 10, price = 2): void {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty, price }]
    })
  }

  it('two-account combined payment writes two fund_flow legs with respective amounts', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      payments: [
        { account_id: ctx.cashId, amount: 2 },
        { account_id: ctx.wechatId, amount: 4 }
      ],
      items: [{ product_id: ctx.productId, qty: 2, price: 3 }]
    })
    expect(doc.total_amount).toBe(6)
    const flows = ctx.db.prepare('SELECT account_id, amount, direction FROM fund_flow WHERE doc_type = ? AND doc_id = ? ORDER BY id').all('retail', doc.id) as Array<{ account_id: number; amount: number; direction: string }>
    expect(flows).toEqual([
      { account_id: ctx.cashId, amount: 2, direction: 'in' },
      { account_id: ctx.wechatId, amount: 4, direction: 'in' }
    ])
  })

  it('discount scales total_amount (rounded to 2 decimals), doc_item amounts unchanged', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      discount: 0.9,
      payments: [{ account_id: ctx.cashId, amount: 5.4 }],
      items: [{ product_id: ctx.productId, qty: 2, price: 3 }]
    })
    expect(doc.total_amount).toBe(5.4)
    const item = ctx.db.prepare('SELECT amount FROM doc_item WHERE doc_id = ?').get(doc.id) as { amount: number }
    expect(item.amount).toBe(6)
  })

  it('invalid discount rejected (0, >1, non-finite)', () => {
    stockUp()
    for (const discount of [0, 1.5, Number.NaN, -0.5]) {
      expect(() => ctx.retailService.create({
        warehouse_id: ctx.whId,
        discount,
        items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
      })).toThrow()
    }
  })

  it('backward compatible: single account_id still writes one flow for full total', () => {
    stockUp()
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      account_id: ctx.cashId,
      items: [{ product_id: ctx.productId, qty: 2, price: 3 }]
    })
    const flows = ctx.db.prepare('SELECT account_id, amount FROM fund_flow WHERE doc_type = ? AND doc_id = ?').all('retail', doc.id) as Array<{ account_id: number; amount: number }>
    expect(flows).toEqual([{ account_id: ctx.cashId, amount: 6 }])
  })

  it('inventory and cost_log unaffected by discount/combined payment', () => {
    stockUp(10, 2)
    const before = ctx.inventoryService.getByProduct(ctx.productId)
    ctx.retailService.create({
      warehouse_id: ctx.whId,
      discount: 0.8,
      payments: [{ account_id: ctx.cashId, amount: 1 }, { account_id: ctx.wechatId, amount: 6.2 }],
      items: [{ product_id: ctx.productId, qty: 3, price: 3 }]
    })
    const after = ctx.inventoryService.getByProduct(ctx.productId)
    expect(after[0]?.qty).toBe((before[0]?.qty ?? 0) - 3)
    const costs = ctx.db.prepare("SELECT change_qty FROM cost_log WHERE product_id = ? AND source = 'retail'").all(ctx.productId) as Array<{ change_qty: number }>
    expect(costs).toEqual([{ change_qty: -3 }])
  })

  it('nonexistent payment account rejected', () => {
    stockUp()
    expect(() => ctx.retailService.create({
      warehouse_id: ctx.whId,
      payments: [{ account_id: 99999, amount: 3 }],
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })).toThrow(/账户不存在/)
  })

  it('combined payment sum mismatch rejected (T8 双审 I3)', () => {
    stockUp()
    expect(() => ctx.retailService.create({
      warehouse_id: ctx.whId,
      payments: [{ account_id: ctx.cashId, amount: 2 }, { account_id: ctx.wechatId, amount: 3 }],
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })).toThrow(/组合收款金额不一致/)
  })

  it('combined payment sum mismatch rejected with discount (netTotal after preferential)', () => {
    stockUp()
    // 3 × 3 × 0.8 = 7.2；收款合计 6 → 拒绝
    expect(() => ctx.retailService.create({
      warehouse_id: ctx.whId,
      discount: 0.8,
      payments: [{ account_id: ctx.cashId, amount: 2 }, { account_id: ctx.wechatId, amount: 4 }],
      items: [{ product_id: ctx.productId, qty: 3, price: 3 }]
    })).toThrow(/组合收款金额不一致/)
  })
})

