import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { applyRounding, readRoundingSetting, DEFAULT_ROUNDING } from '../../src/main/services/sale/rounding.service'
import { BizError } from '../../src/shared/result'
import type { DB } from '../../src/main/services/doc/doc.service'
import type { Database } from 'better-sqlite3'

function setRounding(db: Database, enabled: boolean, mode: 'jiao' | 'yuan' | 'fen'): void {
  db.prepare(
    "INSERT INTO app_setting (key, value) VALUES ('sale.rounding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify({ enabled, mode }))
}

function setup() {
  const db = openMemDb() as DB
  const fund = createFundService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const accountId = fund.create({ name: '现金', type: 'cash' })
  const customerId = customerService.create({ code: 'C001', name: '客户甲', opening_receivable: 0 })
  const supplierId = supplierService.create({ code: 'S001', name: '供应商乙', opening_payable: 0 })
  const warehouseId = Number(
    db.prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓')").run().lastInsertRowid
  )
  const productId = Number(
    db.prepare("INSERT INTO product (code, name, base_unit) VALUES ('P001', '商品1', '件')").run().lastInsertRowid
  )
  // 先进货建立库存
  createPurchaseService(db).create({
    supplier_id: supplierId,
    warehouse_id: warehouseId,
    items: [{ product_id: productId, qty: 100, price: 1 }]
  })
  return { db, accountId, customerId, supplierId, warehouseId, productId }
}

describe('rounding.service（全局抹零）', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('applyRounding: yuan 抹到整数', () => {
    const r = applyRounding({ enabled: true, mode: 'yuan' }, 123.56)
    expect(r.total).toBe(123)
    expect(r.preferential).toBe(0.56)
  })

  it('applyRounding: jiao 抹到角', () => {
    const r = applyRounding({ enabled: true, mode: 'jiao' }, 123.56)
    expect(r.total).toBe(123.5)
    expect(r.preferential).toBe(0.06)
  })

  it('applyRounding: fen / 未启用 不抹零', () => {
    expect(applyRounding({ enabled: true, mode: 'fen' }, 123.56)).toEqual({ total: 123.56, preferential: 0 })
    expect(applyRounding({ enabled: false, mode: 'yuan' }, 123.56)).toEqual({ total: 123.56, preferential: 0 })
    expect(applyRounding(DEFAULT_ROUNDING, 99.99)).toEqual({ total: 99.99, preferential: 0 })
  })

  it('readRoundingSetting: 缺省/非法 JSON/非法字段 回退默认', () => {
    expect(readRoundingSetting(ctx.db)).toEqual(DEFAULT_ROUNDING)
    ctx.db.prepare("INSERT INTO app_setting (key, value) VALUES ('sale.rounding', 'not-json')").run()
    expect(readRoundingSetting(ctx.db)).toEqual(DEFAULT_ROUNDING)
    ctx.db.prepare("UPDATE app_setting SET value = '{\"enabled\":true,\"mode\":\"kuai\"}' WHERE key='sale.rounding'").run()
    expect(readRoundingSetting(ctx.db)).toEqual(DEFAULT_ROUNDING)
  })

  it('sale.service: enabled+yuan 抹零后 total_amount/应收为整数，差额计入 preferential_amount，库存成本不变', () => {
    setRounding(ctx.db, true, 'yuan')
    const doc = createSaleService(ctx.db).create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      items: [{ product_id: ctx.productId, qty: 3, price: 33.35 }]
    })
    // 商品合计 100.05，抹到元 = 100，优惠 0.05
    expect(doc.total_amount).toBe(100)
    expect(doc.preferential_amount).toBe(0.05)
    // 应收（未核销余额）= 100
    const open = createPaymentService(ctx.db).openDocuments('receipt', ctx.customerId)
    expect(open.find((o) => o.id === doc.id)?.remaining).toBe(100)
    // 抹零不入库存成本：成本仍按明细原价
    // 抹零不入库存成本：出库成本仍按移动加权（进价 1）计算，与未抹零时一致
    const cost = ctx.db.prepare(
      "SELECT SUM(CASE WHEN change_qty < 0 THEN -change_qty * unit_cost ELSE 0 END) AS out_cost FROM cost_log WHERE source = 'sale'"
    ).get() as { out_cost: number }
    expect(cost.out_cost).toBeCloseTo(3 * 1)
  })

  it('sale.service: enabled+jiao 抹到角', () => {
    setRounding(ctx.db, true, 'jiao')
    const doc = createSaleService(ctx.db).create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      items: [{ product_id: ctx.productId, qty: 1, price: 12.34 }]
    })
    expect(doc.total_amount).toBe(12.3)
    expect(doc.preferential_amount).toBe(0.04)
  })

  it('sale.service: 未启用抹零不改变金额', () => {
    const doc = createSaleService(ctx.db).create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      items: [{ product_id: ctx.productId, qty: 1, price: 12.34 }]
    })
    expect(doc.total_amount).toBe(12.34)
    expect(doc.preferential_amount).toBe(0)
  })
})

describe('sale 整单优惠（preferential_amount）', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('立减后 total_amount = 商品合计 − 优惠，应收同步', () => {
    const doc = createSaleService(ctx.db).create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      preferential_amount: 5,
      items: [{ product_id: ctx.productId, qty: 2, price: 50 }]
    })
    expect(doc.total_amount).toBe(95)
    expect(doc.preferential_amount).toBe(5)
    const open = createPaymentService(ctx.db).openDocuments('receipt', ctx.customerId)
    expect(open.find((o) => o.id === doc.id)?.remaining).toBe(95)
  })

  it('超额拒绝（优惠 ≥ 商品合计）', () => {
    const svc = createSaleService(ctx.db)
    expect(() =>
      svc.create({
        customer_id: ctx.customerId,
        warehouse_id: ctx.warehouseId,
        preferential_amount: 100,
        items: [{ product_id: ctx.productId, qty: 2, price: 50 }]
      })
    ).toThrowError(BizError)
    expect(() =>
      svc.create({
        customer_id: ctx.customerId,
        warehouse_id: ctx.warehouseId,
        preferential_amount: -1,
        items: [{ product_id: ctx.productId, qty: 1, price: 10 }]
      })
    ).toThrowError(BizError)
  })

  it('退货对称：createReturn 红冲按优惠后 total_amount', () => {
    createSaleService(ctx.db).create({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      preferential_amount: 5,
      items: [{ product_id: ctx.productId, qty: 2, price: 50 }]
    })
    const ret = createSaleService(ctx.db).createReturn({
      customer_id: ctx.customerId,
      warehouse_id: ctx.warehouseId,
      items: [{ product_id: ctx.productId, qty: 1, price: 50 }]
    })
    // 退货按录入金额红冲往来（优惠后应收不受影响：原单 total_amount 已含优惠）
    expect(ret.total_amount).toBeCloseTo(50)
  })
})

describe('retail 整单优惠（preferential，与 discount 并存）', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('立减后 total_amount 正确', () => {
    const doc = createRetailService(ctx.db).create({
      warehouse_id: ctx.warehouseId,
      customer_id: ctx.customerId,
      preferential: 2,
      items: [{ product_id: ctx.productId, qty: 1, price: 30 }]
    })
    expect(doc.total_amount).toBe(28)
    expect(doc.preferential_amount).toBe(2)
  })

  it('discount 与 preferential 叠加：netTotal = Σ*discount − preferential', () => {
    const doc = createRetailService(ctx.db).create({
      warehouse_id: ctx.warehouseId,
      customer_id: ctx.customerId,
      discount: 0.9,
      preferential: 1,
      items: [{ product_id: ctx.productId, qty: 1, price: 100 }]
    })
    expect(doc.total_amount).toBe(89)
    expect(doc.preferential_amount).toBe(1)
  })

  it('超额拒绝', () => {
    const retail = createRetailService(ctx.db)
    expect(() =>
      retail.create({
        warehouse_id: ctx.warehouseId,
        preferential: 100,
        items: [{ product_id: ctx.productId, qty: 1, price: 30 }]
      })
    ).toThrowError(BizError)
  })
})
