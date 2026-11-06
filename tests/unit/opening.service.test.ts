import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createOpeningService } from '../../src/main/services/opening/opening.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'

function setup() {
  const db = openMemDb()
  const productId = createProductService(db).create({ code: 'P001', name: '可乐', base_unit: '罐', retail_price: 3, trade_price: 2.5, purchase_price: 2, tracking_type: 'none', units: [], barcodes: [] })
  const whId = createWarehouseService(db).create({ name: '主仓', is_default: true })
  const customerId = createCustomerService(db).create({ code: 'C001', name: '张三', opening_receivable: 0 })
  const supplierId = createSupplierService(db).create({ code: 'S001', name: '老王供货', opening_payable: 0 })
  return { db, productId, whId, customerId, supplierId }
}

describe('opening.service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('save writes inventory changes and customer/supplier openings, marks done', () => {
    const svc = createOpeningService(ctx.db)
    svc.save({
      inventory: [{ product_id: ctx.productId, warehouse_id: ctx.whId, qty: 100, unit_cost: 2 }],
      customers: [{ customer_id: ctx.customerId, receivable: 120.5 }],
      suppliers: [{ supplier_id: ctx.supplierId, payable: 300 }]
    })
    expect(createInventoryService(ctx.db).getByProduct(ctx.productId, ctx.whId)[0]!.qty).toBe(100)
    expect(createCustomerService(ctx.db).getById(ctx.customerId)?.opening_receivable).toBe(120.5)
    expect(createSupplierService(ctx.db).getById(ctx.supplierId)?.opening_payable).toBe(300)
    expect(svc.getStatus().done).toBe(true)
  })

  it('after done, saving again throws OPENING_DONE', () => {
    const svc = createOpeningService(ctx.db)
    svc.save({ inventory: [], customers: [], suppliers: [] })
    expect(() => svc.save({ inventory: [], customers: [], suppliers: [] })).toThrow()
  })

  it('empty payload is allowed (just mark done)', () => {
    const svc = createOpeningService(ctx.db)
    svc.save({ inventory: [], customers: [], suppliers: [] })
    expect(svc.getStatus().done).toBe(true)
  })
})
