import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'

describe('customer.service.getDetail', () => {
  let db: ReturnType<typeof openMemDb>
  let customerService: ReturnType<typeof createCustomerService>
  let productId: number
  let whId: number

  beforeEach(() => {
    db = openMemDb()
    customerService = createCustomerService(db)
    productId = createProductService(db).create({
      code: 'P001', name: '可乐', base_unit: '罐', retail_price: 3, trade_price: 2.5,
      purchase_price: 2, tracking_type: 'none', units: [], barcodes: []
    })
    whId = createWarehouseService(db).create({ name: '主仓', is_default: true })
  })

  it('returns base info + arrears balance + recent transactions (max 20)', () => {
    const id = customerService.create({ code: 'C001', name: '张三', opening_receivable: 100 })
    const purchase = createPurchaseService(db)
    purchase.create({ warehouse_id: whId, items: [{ product_id: productId, qty: 50, price: 2 }] })
    const retail = createRetailService(db)
    // 25 笔零售挂账交易，验证只取最近 20 笔
    for (let i = 0; i < 25; i++) {
      retail.create({
        warehouse_id: whId,
        customer_id: id,
        items: [{ product_id: productId, qty: 1, price: 3 }]
      })
    }
    const detail = customerService.getDetail(id)
    expect(detail?.customer.name).toBe('张三')
    // 余额 = 期初 100 + 25*3 - 0 = 175
    expect(detail?.arrears).toBe(175)
    expect(detail?.transactions).toHaveLength(20)
    // 最近的排最前（id 降序）
    expect(detail?.transactions[0]?.type).toBe('retail')
  })

  it('returns null for missing customer', () => {
    expect(customerService.getDetail(99999)).toBeNull()
  })
})
