import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createPriceLevelService } from '../../src/main/services/product/price-level.service'
import {
  createCustomerPriceService,
  resolvePrice
} from '../../src/main/services/product/customer-price.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { BizError } from '../../src/shared/result'
import type { Database } from 'better-sqlite3'

const base = {
  code: 'P001',
  name: '可乐 330ml',
  base_unit: '罐',
  retail_price: 3,
  trade_price: 2.5,
  purchase_price: 2,
  tracking_type: 'none' as const
}

let db: Database
let svc: ReturnType<typeof createCustomerPriceService>
let productId: number
let customerId: number
let warehouseId: number

beforeEach(() => {
  db = openMemDb()
  svc = createCustomerPriceService(db)
  productId = createProductService(db).create({ ...base })
  customerId = db
    .prepare("INSERT INTO customer (code, name, opening_receivable) VALUES ('C001', '客户一', 0)")
    .run().lastInsertRowid as number
  warehouseId = db
    .prepare("INSERT INTO warehouse (code, name) VALUES ('W001', '主仓库')")
    .run().lastInsertRowid as number
})

describe('customer-price.service', () => {
  it('setPrice 新建专属价并写变价日志；再次改价记 old→new；同价不重复记日志', () => {
    const row = svc.setPrice(customerId, productId, 2.8, '张三')
    expect(row.price).toBe(2.8)
    expect(row.customer_id).toBe(customerId)
    expect(row.product_id).toBe(productId)

    // 新建日志：old 记商品零售价
    let log = svc.changeLog({ customer_id: customerId, product_id: productId })
    expect(log).not.toHaveLength(0)
    expect(log).toHaveLength(1)
    const first = log[0]
    expect(first).toBeDefined()
    expect(first?.scope).toBe('customer_product')
    expect(first?.old_price).toBe(3)
    expect(first?.new_price).toBe(2.8)
    expect(first?.operator).toBe('张三')

    // 覆盖改价
    svc.setPrice(customerId, productId, 2.5)
    log = svc.changeLog({ customer_id: customerId, product_id: productId })
    expect(log).toHaveLength(2)
    const overwritten = log[0]
    expect(overwritten).toBeDefined()
    expect(overwritten?.old_price).toBe(2.8)
    expect(overwritten?.new_price).toBe(2.5)

    // 同价不再记日志
    svc.setPrice(customerId, productId, 2.5)
    expect(svc.changeLog({ customer_id: customerId, product_id: productId })).toHaveLength(2)
  })

  it('setPrice 校验：价格<0 抛 VALIDATION，客户/商品不存在抛 NOT_FOUND', () => {
    expect(() => svc.setPrice(customerId, productId, -1)).toThrowError(BizError)
    expect(() => svc.setPrice(customerId, productId, -1)).toThrowError(/不小于 0/)
    expect(() => svc.setPrice(999, productId, 1)).toThrowError(/客户不存在/)
    expect(() => svc.setPrice(customerId, 999, 1)).toThrowError(/商品不存在/)
    expect(svc.listByCustomer(customerId)).toEqual([])
  })

  it('removePrice 删除专属价；未维护时静默成功；删除不写变价日志', () => {
    svc.setPrice(customerId, productId, 2.8)
    svc.removePrice(customerId, productId)
    expect(svc.listByCustomer(customerId)).toEqual([])
    expect(resolvePrice(db, { customer_id: customerId, product_id: productId })).toBe(3)

    // 再删一次（无记录）不抛错
    expect(() => svc.removePrice(customerId, productId)).not.toThrow()
  })

  it('listByCustomer / listByProduct 双向列表', () => {
    const p2 = createProductService(db).create({ ...base, code: 'P002', name: '雪碧' })
    svc.setPrice(customerId, productId, 2.8)
    svc.setPrice(customerId, p2, 3.1)
    expect(svc.listByCustomer(customerId)).toHaveLength(2)
    expect(svc.listByProduct(productId)).toHaveLength(1)
    expect(svc.listByProduct(p2)).toHaveLength(1)
    const byP = svc.listByProduct(p2)[0]
    expect(byP).toBeDefined()
    expect(byP?.price).toBe(3.1)
  })

  it('resolvePrice 优先级：专属价 > 客户 price_level 等级价 > 零售价', () => {
    // 建立等级价：批发价 2.5
    createPriceLevelService(db).setLevels(productId, [{ price_level: '批发价', price: 2.5 }])
    // 客户默认等级=批发价
    db.prepare('UPDATE customer SET price_level = ? WHERE id = ?').run('批发价', customerId)

    // 1) 无专属价 → 等级价
    expect(resolvePrice(db, { customer_id: customerId, product_id: productId })).toBe(2.5)

    // 2) 专属价覆盖等级价
    svc.setPrice(customerId, productId, 2.2)
    expect(resolvePrice(db, { customer_id: customerId, product_id: productId })).toBe(2.2)

    // 3) 删专属价，等级价不存在 → 回退零售价
    svc.removePrice(customerId, productId)
    createPriceLevelService(db).setLevels(productId, [{ price_level: '会员价', price: 2.6 }])
    expect(resolvePrice(db, { customer_id: customerId, product_id: productId })).toBe(3)

    // 4) 无客户时直接零售价
    expect(resolvePrice(db, { product_id: productId })).toBe(3)

    // 5) 商品不存在抛 NOT_FOUND
    expect(() => resolvePrice(db, { product_id: 999 })).toThrowError(/商品不存在/)
  })

  it('sale 创建：未传价兜底走取价链路；显式价不被覆盖', () => {
    db.prepare(
      "INSERT INTO inventory (product_id, warehouse_id, batch_no, qty) VALUES (?, ?, '', 100)"
    ).run(productId, warehouseId)
    svc.setPrice(customerId, productId, 2.2)

    const sale = createSaleService(db)

    // 未传价（undefined）→ 兜底专属价 2.2
    const docA = sale.create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 1 } as never]
    })
    const itemA = docServicePrice(sale, docA.id)
    expect(itemA).toBe(2.2)

    // 显式传价 → 不被覆盖
    const docB = sale.create({
      customer_id: customerId,
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 1, price: 9.9 }]
    })
    expect(docServicePrice(sale, docB.id)).toBe(9.9)
  })

  it('changeLog 过滤：按客户/商品/范围独立生效', () => {
    const p2 = createProductService(db).create({ ...base, code: 'P002', name: '雪碧' })
    svc.setPrice(customerId, productId, 2.8)
    svc.setPrice(customerId, p2, 3.1)
    // price_level 范围的日志（模拟等级调价写入）
    db
      .prepare(
        "INSERT INTO price_change_log (scope, customer_id, product_id, old_price, new_price) VALUES ('price_level', NULL, ?, 3, 2.5)"
      )
      .run(productId)

    expect(svc.changeLog({ customer_id: customerId })).toHaveLength(2)
    expect(svc.changeLog({ product_id: p2 })).toHaveLength(1)
    expect(svc.changeLog({ product_id: productId })).toHaveLength(2)
    expect(svc.changeLog({ scope: 'price_level' })).toHaveLength(1)
    expect(svc.changeLog({})).toHaveLength(3)
    // 新的在前
    const latest = svc.changeLog({ customer_id: customerId })[0]
    expect(latest?.product_id).toBe(p2)
  })
})

/** 读取销售单明细的实际单价 */
function docServicePrice(sale: ReturnType<typeof createSaleService>, docId: number): number {
  const detail = sale.getDetail(docId)
  return (detail.items[0] as { price: number }).price
}
