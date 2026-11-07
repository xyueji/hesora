import { afterEach, beforeEach, expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createWorkflowService } from '../../src/main/services/workflow/workflow.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createProductService } from '../../src/main/services/product/product.service'
import type { WorkflowInput } from '../../src/shared/types/workflow'

let db: ReturnType<typeof openMemDb>
let data: WorkflowInput

beforeEach(() => {
  db = openMemDb()
  const product = createProductService(db).create({ code: 'W1', name: '配件', base_unit: '件', retail_price: 6, trade_price: 5, purchase_price: 3, tracking_type: 'none' })
  const warehouse = Number(db.prepare("INSERT INTO warehouse (code, name) VALUES ('W', '主仓')").run().lastInsertRowid)
  data = { kind: 'quote', warehouse_id: warehouse, date: '2026-11-07', items: [{ product_id: product, unit: '件', qty: 2, price: 5 }] }
})
afterEach(() => db.close())

it('links quote → order → sale and posts only once after approval', () => {
  const service = createWorkflowService(db)
  const purchase = createPurchaseService(db)
  purchase.create({ warehouse_id: data.warehouse_id, items: [{ ...data.items[0]!, qty: 5, price: 3 }] })
  const stock = () => createInventoryService(db).getByProduct(data.items[0]!.product_id, data.warehouse_id)[0]?.qty
  const draft = service.save(data, 1)
  expect(() => service.convert(draft.id, 1)).toThrow(/审核/)
  service.approve(draft.id, 1)
  const order = service.convert(draft.id, 1)
  expect(order.source_id).toBe(draft.id)
  service.approve(order.id, 1)
  const sale = service.convert(order.id, 1)
  expect(sale.kind).toBe('sale')
  expect(stock()).toBe(5)
  const posted = service.approve(sale.id, 1)
  expect(posted.posted_doc_id).toBeGreaterThan(0)
  expect(stock()).toBe(3)
  expect(() => service.approve(sale.id, 1)).toThrow(/草稿/)
  expect(stock()).toBe(3)
})

it('keeps the draft editable when approval cannot post inventory', () => {
  const service = createWorkflowService(db)
  const draft = service.save({ ...data, kind: 'sale' }, 1)
  expect(() => service.approve(draft.id, 1)).toThrow(/库存不足/)
  expect(service.get(draft.id).status).toBe('draft')
  expect(db.prepare('SELECT COUNT(*) FROM doc').pluck().get()).toBe(0)
  const updated = service.save({ ...data, kind: 'sale', id: draft.id, remark: '等待到货' }, 1)
  expect(updated.remark).toBe('等待到货')
})

it('converts a purchase order to a receipt and keeps the relationship', () => {
  const service = createWorkflowService(db)
  const order = service.save({ ...data, kind: 'purchase_order' }, 1)
  service.approve(order.id, 1)
  const purchase = service.convert(order.id, 1)
  expect(purchase.kind).toBe('purchase')
  expect(purchase.source_id).toBe(order.id)
  expect(() => service.convert(order.id, 1)).toThrow(/已转单/)
  service.approve(purchase.id, 1)
  expect(createInventoryService(db).getByProduct(data.items[0]!.product_id, data.warehouse_id)[0]?.qty).toBe(2)
})

it('supports the direct quote-to-sale route and rejects cross-domain conversions', () => {
  const service = createWorkflowService(db)
  const quote = service.save(data, 1)
  service.approve(quote.id, 1)
  expect(() => service.convert(quote.id, 1, 'purchase')).toThrow(/转单/)
  const sale = service.convert(quote.id, 1, 'sale')
  expect(sale).toMatchObject({ source_id: quote.id, kind: 'sale', status: 'draft' })
  expect(db.prepare('SELECT COUNT(*) FROM doc').pluck().get()).toBe(0)
})

it('tracks reservations, cancellation and successive receipts by original order line', () => {
  const service = createWorkflowService(db)
  const line = data.items[0]!
  const order = service.save({ ...data, kind: 'purchase_order', items: [{ ...line, qty: 10 }, { ...line, qty: 4, price: 6 }] }, 1)
  service.approve(order.id, 1)
  const first = service.convert(order.id, 1, 'purchase', [{ line: 0, qty: 6 }, { line: 1, qty: 2 }])
  expect(service.get(order.id).fulfillment).toMatchObject({ lines: [{ posted: 0, reserved: 6, remaining: 4 }, { posted: 0, reserved: 2, remaining: 2 }] })
  expect(() => service.convert(order.id, 1, 'purchase', [{ line: 0, qty: 5 }])).toThrow(/剩余/)
  const second = service.convert(order.id, 1, 'purchase', [{ line: 0, qty: 4 }])
  service.cancel(second.id, 1)
  service.approve(first.id, 1)
  expect(service.get(order.id).fulfillment).toMatchObject({ lines: [{ posted: 6, reserved: 0, remaining: 4 }, { posted: 2, reserved: 0, remaining: 2 }] })
  const rest = service.convert(order.id, 1, 'purchase')
  expect(rest.items.map((row) => row.qty)).toEqual([4, 2])
  service.approve(rest.id, 1)
  expect(service.get(order.id).fulfillment?.state).toBe('completed')
  expect(service.get(order.id).fulfillment?.batches.map((batch) => batch.status)).toEqual(['approved', 'cancelled', 'approved'])
  expect(createInventoryService(db).getByProduct(line.product_id, order.warehouse_id)[0]?.qty).toBe(14)
  expect(service.list(1, 'purchase_order').list).toHaveLength(1)
})

it('cannot change the parent quantity or stock identity and preserves a failed shipment reservation', () => {
  const service = createWorkflowService(db)
  const order = service.save({ ...data, kind: 'sale_order' }, 1)
  service.approve(order.id, 1)
  const child = service.convert(order.id, 1, 'sale', [{ line: 0, qty: 1 }])
  const item = child.items[0]!
  expect(() => service.save({ ...child, items: [{ ...item, rate: 2 }] }, 1)).toThrow(/订单/)
  expect(() => service.save({ ...child, items: [{ ...item, qty: 3 }] }, 1)).toThrow(/剩余/)
  expect(() => service.approve(child.id, 1)).toThrow(/库存不足/)
  expect(service.get(child.id).status).toBe('draft')
  expect(service.get(order.id).fulfillment?.lines[0]).toMatchObject({ posted: 0, reserved: 1, remaining: 1 })
})

it('preserves legacy one-shot conversions without inventing remaining quantities', () => {
  const service = createWorkflowService(db)
  const order = service.save({ ...data, kind: 'purchase_order' }, 1)
  service.approve(order.id, 1)
  const oldId = Number(db.prepare("INSERT INTO doc_workflow (kind, body, source_id) VALUES ('purchase', ?, ?)")
    .run(JSON.stringify({ warehouse_id: data.warehouse_id, date: data.date, items: data.items }), order.id).lastInsertRowid)
  expect(service.get(order.id).fulfillment).toMatchObject({ state: 'legacy', batches: [{ id: oldId, status: 'draft' }] })
  expect(() => service.convert(order.id, 1, 'purchase', [{ line: 0, qty: 1 }])).toThrow(/已转单/)
  service.cancel(oldId, 1)
  expect(service.convert(order.id, 1, 'purchase', [{ line: 0, qty: 1 }]).items[0]?.source_line).toBe(0)
})
