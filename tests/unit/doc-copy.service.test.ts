import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createDocCopyService } from '../../src/main/services/doc/copy.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'
import { BizError } from '../../src/shared/result'

interface DocDbRow {
  id: number
  no: string
  type: string
  date: string
  partner_id: number | null
  remark: string | null
  status: string
  source_doc_id: number | null
  total_amount: number
}

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const purchaseService = createPurchaseService(db)
  const saleService = createSaleService(db)
  const inventoryService = createInventoryService(db)
  const docService = createDocService(db)
  const copyService = createDocCopyService(db)

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
  const customerId = customerService.create({
    code: 'C001',
    name: '测试客户',
    opening_receivable: 0
  })
  const otherCustomerId = customerService.create({
    code: 'C002',
    name: '另一个客户',
    opening_receivable: 0
  })

  // 先入库 10 箱（120 基本单位），再销售 1 箱
  purchaseService.create({
    warehouse_id: whId,
    date: '2026-11-07',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 10, price: 24 }]
  })
  const saleDoc = saleService.create({
    warehouse_id: whId,
    customer_id: customerId,
    date: '2026-11-07',
    remark: '原单备注',
    items: [{ product_id: productId, unit: '箱', rate: 12, qty: 1, price: 30 }]
  })

  return {
    db,
    copyService,
    docService,
    inventoryService,
    saleDoc,
    productId,
    whId,
    customerId,
    otherCustomerId
  }
}

describe('doc-copy.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('copy: 生成新单号的新单据，明细与原单一致', () => {
    const copied = ctx.copyService.copy(ctx.saleDoc.id)
    expect(copied.id).not.toBe(ctx.saleDoc.id)
    expect(copied.no).not.toBe(ctx.saleDoc.no)
    expect(copied.no).toMatch(/^XS\d{8}\d{4}$/)
    expect(copied.type).toBe('sale')
    expect(copied.copied_from_no).toBe(ctx.saleDoc.no)
    expect(copied.source_doc_id).toBe(ctx.saleDoc.id)
    expect(copied.items).toHaveLength(1)
    expect(copied.items[0]!.product_id).toBe(ctx.productId)
    expect(copied.items[0]!.qty).toBe(1)
    expect(copied.items[0]!.rate).toBe(12)
    expect(copied.items[0]!.price).toBe(30)
    expect(copied.items[0]!.amount).toBe(30)
    expect(copied.total_amount).toBe(30)

    const rows = ctx.db
      .prepare('SELECT * FROM doc_item WHERE doc_id = ? ORDER BY id')
      .all(copied.id) as Array<{ product_id: number; qty: number; price: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.qty).toBe(1)
  })

  it('copy: 新单为草稿状态，且不产生任何库存变动', () => {
    const before = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    const copied = ctx.copyService.copy(ctx.saleDoc.id)
    const after = ctx.inventoryService.getByProduct(ctx.productId, ctx.whId)
    expect(after).toHaveLength(before.length)
    expect(after[0]!.qty).toBe(before[0]!.qty)
    expect(after[0]!.moving_cost).toBe(before[0]!.moving_cost)
    const docRow = ctx.db
      .prepare('SELECT * FROM doc WHERE id = ?')
      .get(copied.id) as DocDbRow
    expect(docRow.status).toBe('draft')
    const logs = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM cost_log WHERE source_id = ?')
      .get(copied.id) as { c: number }
    expect(logs.c).toBe(0)
  })

  it('copy: 不支持复制的单据类型被拒绝', () => {
    const transfer = ctx.docService.create({
      type: 'transfer',
      date: '2026-11-07',
      warehouse_id: ctx.whId,
      items: [{ product_id: ctx.productId, qty: 1, price: 1 }]
    })
    expect(() => ctx.copyService.copy(transfer.id)).toThrowError(/该单据类型不支持复制/)
  })

  it('copy: 单据不存在时抛出 NOT_FOUND', () => {
    try {
      ctx.copyService.copy(999999)
      throw new Error('不应该走到这里')
    } catch (e) {
      expect(e).toBeInstanceOf(BizError)
      const err = e as BizError
      expect(err.code).toBe('NOT_FOUND')
      expect(err.message).toBe('单据不存在')
    }
  })

  it('copy: overrides 只允许改日期 / 往来单位 / 备注', () => {
    const copied = ctx.copyService.copy(ctx.saleDoc.id, {
      date: '2026-12-01',
      partner_id: ctx.otherCustomerId,
      remark: '再来一单'
    })
    expect(copied.date).toBe('2026-12-01')
    expect(copied.partner_id).toBe(ctx.otherCustomerId)
    expect(copied.remark).toBe('再来一单')
    expect(copied.no.startsWith('XS20261201')).toBe(true)
    // 未覆盖的字段沿用原单
    expect(copied.warehouse_id).toBe(ctx.saleDoc.warehouse_id)
    expect(copied.items).toHaveLength(1)
    // 原单不受影响
    const origin = ctx.db
      .prepare('SELECT * FROM doc WHERE id = ?')
      .get(ctx.saleDoc.id) as DocDbRow
    expect(origin.remark).toBe('原单备注')
    expect(origin.date).toBe('2026-11-07')
  })

  it('copy: 未传 overrides 时沿用原单日期与备注', () => {
    const copied = ctx.copyService.copy(ctx.saleDoc.id)
    expect(copied.date).toBe('2026-11-07')
    expect(copied.remark).toBe('原单备注')
    expect(copied.partner_id).toBe(ctx.customerId)
  })

  it('copy: 连续复制生成互不相同的单号', () => {
    const a = ctx.copyService.copy(ctx.saleDoc.id)
    const b = ctx.copyService.copy(ctx.saleDoc.id)
    const c = ctx.copyService.copy(a.id)
    expect(a.no).not.toBe(b.no)
    expect(b.no).not.toBe(c.no)
    const numbers = new Set([a.no, b.no, c.no])
    expect(numbers.size).toBe(3)
    const rows = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM doc WHERE no IN (?, ?, ?)')
      .get(a.no, b.no, c.no) as { c: number }
    expect(rows.c).toBe(3)
  })

  it('copy: 复制的单据不参与原单库存，可再次复制', () => {
    const first = ctx.copyService.copy(ctx.saleDoc.id)
    const second = ctx.copyService.copy(first.id)
    expect(second.items).toHaveLength(1)
    expect(second.copied_from_no).toBe(first.no)
  })
})
