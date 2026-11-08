import { describe, it, expect, beforeAll } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createWorkflowService } from '../../src/main/services/workflow/workflow.service'
import { createReversalService } from '../../src/main/services/doc/reversal.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import type { Database } from 'better-sqlite3'

// P1-5：红冲应回退订单履行进度——posted 单被红冲后，订单行的 posted 应归零、
// remaining 恢复，且订单可重新转单（原 child 已被红冲，不再占用"已转单"名额）。
describe('reversal rolls back order fulfillment progress', () => {
  let db: Database
  let productId: number
  let customerId: number
  let whId: number

  beforeAll(() => {
    db = openMemDb()
    const products = createProductService(db)
    productId = products.create({
      code: 'REVSKU1', name: '红冲测试商品', base_unit: '个',
      retail_price: 10, trade_price: 9, purchase_price: 6,
      tracking_type: 'none', units: [], barcodes: []
    })
    const customers = createCustomerService(db)
    customerId = customers.create({ code: 'RC1', name: '红冲客户', opening_receivable: 0 })
    whId = createWarehouseService(db).create({ name: '主仓', is_default: true })
  })

  it('after reversing the posted child, fulfillment shows pending and order can re-convert', () => {
    const wf = createWorkflowService(db)
    const reversal = createReversalService(db)

    // 先采购入库 20 个，保证销售出库有货
    createPurchaseService(db).create({ warehouse_id: whId, items: [{ product_id: productId, unit: '个', qty: 20, price: 6 }] })

    // 销售订单 10 个
    const order = wf.save({
      kind: 'sale_order', date: '2026-01-01', warehouse_id: whId, customer_id: customerId,
      items: [{ product_id: productId, unit: '个', qty: 10, price: 9 }]
    } as never, 1)
    wf.approve(order.id, 1)

    // 整单转销售出库并过账
    const child = wf.convert(order.id, 1)
    const posted = wf.approve(child.id, 1)
    expect(posted.posted_doc_id).not.toBeNull()

    // 履行：completed，posted=10
    type FF = { state: string; lines: { posted: number; remaining: number }[] }
    let ff = (wf.get(order.id) as unknown as { fulfillment: FF }).fulfillment
    expect(ff.state).toBe('completed')
    expect(ff.lines[0]!.posted).toBe(10)

    // 红冲该出库单
    reversal.reverse(Number(posted.posted_doc_id), 'admin')

    // 履行回退：posted 归零，state 回 pending，remaining=10
    ff = (wf.get(order.id) as unknown as { fulfillment: FF }).fulfillment
    expect(ff.lines[0]!.posted).toBe(0)
    expect(ff.lines[0]!.remaining).toBe(10)
    expect(ff.state).toBe('pending')

    // 被红冲的批次保留展示且带 reversed 标记（可追溯）
    type Batch = { id: number; reversed?: boolean }
    const batches = (wf.get(order.id) as unknown as { fulfillment: { batches: Batch[] } }).fulfillment.batches
    expect(batches).toHaveLength(1)
    expect(batches[0]!.id).toBe(child.id)
    expect(batches[0]!.reversed).toBe(true)

    // 订单可以重新转单（已红冲的 child 不再阻塞）
    const reChild = wf.convert(order.id, 1)
    expect(reChild.id).toBeGreaterThan(child.id)
    expect(reChild.status).toBe('draft')
  })
})
