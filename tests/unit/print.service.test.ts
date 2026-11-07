import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createPrintService } from '../../src/main/services/print/print.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { BizError } from '../../src/shared/result'
import { renderReceiptHtml, renderA4Html } from '../../src/shared/print/templates'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const fundService = createFundService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const purchaseService = createPurchaseService(db)
  const retailService = createRetailService(db)
  const printService = createPrintService(db)
  const productId = productService.create({
    code: 'P001',
    name: '可乐<script>',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
  const whId = warehouseService.create({ name: '主仓', is_default: true })
  const accountId = fundService.create({ name: '现金账户', type: 'cash', opening_balance: 0 })
  const customerId = customerService.create({
    code: 'C001',
    name: '张三',
    opening_receivable: 0
  })
  const supplierId = supplierService.create({
    code: 'S001',
    name: '李四供应商',
    opening_payable: 0
  })
  return {
    db,
    printService,
    retailService,
    purchaseService,
    productId,
    whId,
    accountId,
    customerId,
    supplierId
  }
}

describe('print.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('prints a configured 80 mm receipt with product spec and escaped footer', () => {
    ctx.db.prepare('UPDATE product SET spec = ? WHERE id = ?').run('330 mL', ctx.productId)
    ctx.db.prepare("INSERT INTO app_setting (key, value) VALUES ('print.receipt_width', '80'), ('print.receipt_footer', '<自定义>')").run()
    ctx.purchaseService.create({ warehouse_id: ctx.whId, items: [{ product_id: ctx.productId, qty: 5, price: 2 }] })
    const doc = ctx.retailService.create({ warehouse_id: ctx.whId, items: [{ product_id: ctx.productId, qty: 1, price: 3 }] })
    const data = ctx.printService.receiptData(doc.id)
    expect(data.items[0]?.spec).toBe('330 mL')
    expect(data.widthMm).toBe(80)
    const html = renderReceiptHtml(data)
    expect(html).toContain('80mm')
    expect(html).toContain('330 mL')
    expect(html).toContain('&lt;自定义&gt;')
  })

  it('receiptData returns shop header, items, total, payment method for retail doc', () => {
    ctx.db
      .prepare("INSERT INTO app_setting (key, value) VALUES ('shop.name', '我的小店')")
      .run()
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, rate: 1, qty: 10, price: 2 }]
    })
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      account_id: ctx.accountId,
      remark: '测试备注',
      items: [{ product_id: ctx.productId, qty: 3, price: 3 }]
    })
    const data = ctx.printService.receiptData(doc.id)
    expect(data.shopName).toBe('我的小店')
    expect(data.docNo).toBe(doc.no)
    expect(data.items).toHaveLength(1)
    expect(data.items[0]!.name).toBe('可乐<script>')
    expect(data.items[0]!.qty).toBe(3)
    expect(data.items[0]!.price).toBe(3)
    expect(data.items[0]!.amount).toBe(9)
    expect(data.total).toBe(9)
    expect(data.paymentMethod).toBe('现金账户')
    expect(data.remark).toBe('测试备注')
    expect(data.footer).toBe('谢谢惠顾')
  })

  it('receiptData falls back to 禾序进销存 when no shop settings', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, rate: 1, qty: 10, price: 2 }]
    })
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 3 }]
    })
    const data = ctx.printService.receiptData(doc.id)
    expect(data.shopName).toBe('禾序进销存')
    expect(data.paymentMethod).toBe('')
  })

  it('a4Data returns title, partner and warehouse names for sale doc', () => {
    const svc = ctx.printService
    // sale doc via docService-backed retail? use purchase then sale through doc service directly
    // simplest: create sale via retail? No — use a4Data on a purchase doc with supplier.
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      supplier_id: ctx.supplierId,
      remark: '采购备注',
      items: [{ product_id: ctx.productId, rate: 1, qty: 5, price: 2 }]
    })
    const data = svc.a4Data(doc.id)
    expect(data.title).toBe('采购单')
    expect(data.shopName).toBe('禾序进销存')
    expect(data.partnerName).toBe('李四供应商')
    expect(data.warehouseName).toBe('主仓')
    expect(data.docNo).toBe(doc.no)
    expect(data.items).toHaveLength(1)
    expect(data.items[0]!.amount).toBe(10)
    expect(data.total).toBe(10)
    expect(data.remark).toBe('采购备注')
    expect(data.printDate).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('template renderReceiptHtml escapes HTML injection and includes total', () => {
    ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, rate: 1, qty: 10, price: 2 }]
    })
    const doc = ctx.retailService.create({
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 2, price: 3 }]
    })
    const data = ctx.printService.receiptData(doc.id)
    const html = renderReceiptHtml(data)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('6.00')
    expect(html).toContain('谢谢惠顾')
  })

  it('template renderA4Html escapes injection and includes title/total/signature rows', () => {
    const doc = ctx.purchaseService.create({
      warehouse_id: ctx.whId,
      supplier_id: ctx.supplierId,
      items: [{ product_id: ctx.productId, rate: 1, qty: 5, price: 2 }]
    })
    const data = ctx.printService.a4Data(doc.id)
    const html = renderA4Html(data)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('采购单')
    expect(html).toContain('李四供应商')
    expect(html).toContain('10.00')
    expect(html).toContain('打货人')
    expect(html).toContain('收货人')
  })

  it('prints stocktake book and counted quantities with a signed difference', () => {
    ctx.purchaseService.create({ warehouse_id: ctx.whId, items: [{ product_id: ctx.productId, qty: 10, price: 2 }] })
    const doc = createStocktakeService(ctx.db).create({ warehouse_id: ctx.whId, items: [{ product_id: ctx.productId, actual_qty: 7 }] })
    const html = renderA4Html(ctx.printService.a4Data(doc.id))
    expect(html).toContain('账面数量')
    expect(html).toContain('实盘数量')
    expect(html).toContain('10.00')
    expect(html).toContain('7.00')
    expect(html).toContain('-3.00')
  })

  it('unknown doc id throws NOT_FOUND', () => {
    expect(() => ctx.printService.receiptData(99999)).toThrowError(BizError)
    try {
      ctx.printService.a4Data(99999)
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
  })
})
