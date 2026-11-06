import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const inventoryService = createInventoryService(db)
  const purchaseService = createPurchaseService(db)
  const saleService = createSaleService(db)
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
  const customerId = customerService.create({
    code: 'C001',
    name: '测试客户',
    opening_receivable: 0
  })
  const supplierId = supplierService.create({
    code: 'S001',
    name: '测试供应商',
    opening_payable: 0
  })
  return {
    db,
    saleService,
    purchaseService,
    inventoryService,
    productId,
    whId,
    customerId,
    supplierId
  }
}

function stockOf(db: DB, productId: number, whId: number): { qty: number; moving_cost: number } {
  const row = db
    .prepare('SELECT qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?')
    .get(productId, whId, '') as { qty: number; moving_cost: number } | undefined
  return row ?? { qty: 0, moving_cost: 0 }
}

describe('return.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('purchase return: stock reduced, doc CT, fund_flow out row', () => {
    const { db, purchaseService, productId, whId, supplierId } = ctx
    purchaseService.create({
      supplier_id: supplierId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 10, price: 2 }]
    })
    expect(stockOf(db, productId, whId).qty).toBe(10)

    const doc = purchaseService.createReturn({
      supplier_id: supplierId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 4, price: 2 }]
    })
    expect(doc.no).toMatch(/^CT\d{8}\d{4}$/)
    expect(doc.total_amount).toBe(8)
    expect(stockOf(db, productId, whId).qty).toBe(6)

    const flow = db
      .prepare("SELECT * FROM fund_flow WHERE doc_id = ? AND doc_type = 'purchase_return'")
      .get(doc.id) as { direction: string; amount: number } | undefined
    expect(flow).toBeDefined()
    expect(flow?.direction).toBe('out')
    expect(flow?.amount).toBe(8)
  })

  it('sale return after sale: stock increased at current moving_cost, doc XT, fund_flow in', () => {
    const { db, purchaseService, saleService, productId, whId, customerId } = ctx
    purchaseService.create({
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 100, price: 2 }]
    })
    const saleDoc = saleService.create({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 10, price: 3 }]
    })
    expect(stockOf(db, productId, whId)).toEqual({ qty: 90, moving_cost: 2 })

    const doc = saleService.createReturn({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 10, price: 3 }]
    })
    expect(doc.no).toMatch(/^XT\d{8}\d{4}$/)
    expect(doc.total_amount).toBe(30)
    // 退货按当前移动加权成本入库
    expect(stockOf(db, productId, whId)).toEqual({ qty: 100, moving_cost: 2 })

    const flow = db
      .prepare("SELECT * FROM fund_flow WHERE doc_id = ? AND doc_type = 'sale_return'")
      .get(doc.id) as { direction: string; amount: number } | undefined
    expect(flow?.direction).toBe('in')
    expect(flow?.amount).toBe(30)

    const costLog = db
      .prepare("SELECT * FROM cost_log WHERE source = 'sale_return' AND source_id = ?")
      .get(doc.id) as { change_qty: number; unit_cost: number } | undefined
    expect(costLog?.change_qty).toBe(10)
    expect(costLog?.unit_cost).toBe(2)
    expect(saleDoc).toBeDefined()
  })

  it('sale return more than sold but within stock: allowed', () => {
    const { db, purchaseService, saleService, productId, whId, customerId } = ctx
    purchaseService.create({
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 50, price: 2 }]
    })
    saleService.create({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 5, price: 3 }]
    })
    // 退 20 > 卖 5，但库存 45 足够：无原单关联，允许
    const doc = saleService.createReturn({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 20, price: 3 }]
    })
    expect(stockOf(db, productId, whId).qty).toBe(45 + 20)
    expect(doc.no).toMatch(/^XT/)
  })

  it('sale return with no existing stock row: IN at cost 0 allowed', () => {
    const { db, saleService, productId, whId, customerId } = ctx
    const doc = saleService.createReturn({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 3, price: 3 }]
    })
    expect(stockOf(db, productId, whId)).toEqual({ qty: 3, moving_cost: 0 })
    const costLog = db
      .prepare("SELECT * FROM cost_log WHERE source = 'sale_return' AND source_id = ?")
      .get(doc.id) as { unit_cost: number }
    expect(costLog.unit_cost).toBe(0)
  })

  it('purchase return exceeding stock: NOT_ENOUGH, rollback including doc and fund_flow', () => {
    const { db, purchaseService, productId, whId, supplierId } = ctx
    purchaseService.create({
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 5, price: 2 }]
    })
    expect(() =>
      purchaseService.createReturn({
        supplier_id: supplierId,
        warehouse_id: whId,
        items: [{ product_id: productId, qty: 10, price: 2 }]
      })
    ).toThrowError(/库存不足/)
    expect(stockOf(db, productId, whId).qty).toBe(5)
    expect(db.prepare('SELECT COUNT(*) AS n FROM doc').get() as { n: number }).toEqual({ n: 1 }) // 仅进货单
    expect((db.prepare('SELECT COUNT(*) AS n FROM fund_flow').get() as { n: number }).n).toBe(0)
  })

  it('getDetail works for return docs; query type filter', () => {
    const { purchaseService, saleService, productId, whId, supplierId, customerId } = ctx
    purchaseService.create({
      supplier_id: supplierId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 10, price: 2 }]
    })
    const ret = purchaseService.createReturn({
      supplier_id: supplierId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 2, price: 2 }]
    })
    const d1 = purchaseService.getDetail(ret.id)
    expect(d1.doc.type).toBe('purchase_return')
    expect(d1.items).toHaveLength(1)
    expect(d1.items[0]?.qty).toBe(2)

    const pr = purchaseService.query({ page: 1, pageSize: 10, type: 'purchase_return' })
    expect(pr.total).toBe(1)
    expect(pr.items[0]?.no).toMatch(/^CT/)
    const pAll = purchaseService.query({ page: 1, pageSize: 10, type: 'purchase' })
    expect(pAll.total).toBe(1)
    const pBase = purchaseService.query({ page: 1, pageSize: 10 })
    expect(pBase.total).toBe(2)

    saleService.create({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 4, price: 3 }]
    })
    const sret = saleService.createReturn({
      customer_id: customerId,
      warehouse_id: whId,
      items: [{ product_id: productId, qty: 1, price: 3 }]
    })
    const d2 = saleService.getDetail(sret.id)
    expect(d2.doc.type).toBe('sale_return')
    const sr = saleService.query({ page: 1, pageSize: 10, type: 'sale_return' })
    expect(sr.total).toBe(1)
    expect(sr.items[0]?.no).toMatch(/^XT/)
  })

  it('return validation: empty items and bad qty rejected', () => {
    const { purchaseService, saleService, productId, whId } = ctx
    expect(() =>
      purchaseService.createReturn({ warehouse_id: whId, items: [] })
    ).toThrowError(/明细不能为空/)
    expect(() =>
      saleService.createReturn({
        warehouse_id: whId,
        items: [{ product_id: productId, qty: 0, price: 1 }]
      })
    ).toThrowError(/数量必须大于0/)
  })
})
