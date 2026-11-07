import { expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createSerialService } from '../../src/main/services/inventory/serial.service'
import { createShelfLifeService } from '../../src/main/services/product/shelf-life.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createTransferService } from '../../src/main/services/transfer/transfer.service'

function setup() {
  const db = openMemDb()
  const product = createProductService(db)
  const warehouse = createWarehouseService(db)
  const main = warehouse.create({ name: '主仓', is_default: true })
  const branch = warehouse.create({ name: '副仓', is_default: false })
  const makeProduct = (tracking_type: 'batch' | 'serial') => product.create({
    code: tracking_type, name: tracking_type, tracking_type, base_unit: '件',
    retail_price: 10, trade_price: 10, purchase_price: 5
  })
  return {
    db, main, branch, makeProduct,
    inventory: createInventoryService(db), serial: createSerialService(db), shelf: createShelfLifeService(db),
    purchase: createPurchaseService(db), sale: createSaleService(db), transfer: createTransferService(db)
  }
}

it('keeps batch expiry and balances consistent across sale, transfer and return', () => {
  const ctx = setup()
  const product_id = ctx.makeProduct('batch')
  const common = { warehouse_id: ctx.main, date: '2026-11-07' }
  const expired = { product_id, batch_no: 'L1', qty: 5, price: 5, expire_date: '2026-11-06' }
  const fresh = { product_id, batch_no: 'L2', qty: 5, price: 5, expire_date: '2099-12-31' }
  ctx.purchase.create({ ...common, items: [expired, fresh] })
  expect(ctx.shelf.listBatches({ page: 1, pageSize: 10 }).list).toEqual(expect.arrayContaining([
    expect.objectContaining({ batch_no: 'L1', expire_date: expired.expire_date, qty: 5 }),
    expect.objectContaining({ batch_no: 'L2', expire_date: fresh.expire_date, qty: 5 })
  ]))
  expect(() => ctx.sale.create({ ...common, items: [{ ...expired, qty: 1 }] })).toThrow(/过期/)
  const sale = ctx.sale.create({ ...common, items: [{ ...fresh, qty: 2 }] })
  ctx.transfer.create({ ...common, warehouse_in_id: ctx.branch, items: [{ ...fresh, qty: 1 }] })
  ctx.sale.createReturn({ ...common, source_doc_id: sale.id, items: [{ ...fresh, qty: 1 }] })
  const lots = ctx.shelf.listBatches({ product_id, page: 1, pageSize: 10 }).list
  expect(lots).toEqual(expect.arrayContaining([
    expect.objectContaining({ warehouse_id: ctx.main, batch_no: 'L1', qty: 5 }),
    expect.objectContaining({ warehouse_id: ctx.main, batch_no: 'L2', qty: 3 }),
    expect.objectContaining({ warehouse_id: ctx.branch, batch_no: 'L2', qty: 1, expire_date: fresh.expire_date })
  ]))
})

it('posts serials atomically and permits a return only from the original sale', () => {
  const ctx = setup()
  const product_id = ctx.makeProduct('serial')
  const common = { warehouse_id: ctx.main }
  const line = { product_id, qty: 1, price: 5, serial_numbers: ['SN-01'] }
  ctx.purchase.create({ ...common, items: [{ ...line, qty: 2, serial_numbers: ['SN-01', 'SN-02'] }] })
  expect(ctx.serial.stockOf(product_id)).toBe(2)
  expect(() => ctx.purchase.create({ ...common, items: [line] })).toThrow(/序列号已存在/)
  const sale = ctx.sale.create({ ...common, items: [line] })
  expect(ctx.serial.stockOf(product_id)).toBe(1)
  expect(() => ctx.sale.create({ ...common, items: [line] })).toThrow(/序列号/)
  expect(() => ctx.transfer.create({ ...common, warehouse_in_id: ctx.branch, items: [line] })).toThrow(/序列号/)
  expect(() => ctx.sale.createReturn({
    ...common, source_doc_id: sale.id, items: [{ ...line, serial_numbers: ['SN-02'] }]
  })).toThrow(/序列号/)
  const returned = ctx.sale.createReturn({ ...common, source_doc_id: sale.id, items: [line] })
  expect(ctx.serial.stockOf(product_id)).toBe(2)
  expect(ctx.serial.listFlow({ sn: 'SN-01', page: 1, pageSize: 10 }).items.map((row) => row.doc_id))
    .toEqual([returned.id, sale.id, 1])
  expect(ctx.inventory.getByProduct(product_id, ctx.main)[0]?.qty).toBe(2)
  expect(ctx.inventory.listCostLogs(product_id)).toHaveLength(3)
  expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM doc').get()).toEqual({ n: 3 })
  ctx.transfer.create({ ...common, warehouse_in_id: ctx.branch, items: [line] })
  expect(ctx.serial.listStock({ warehouse_id: ctx.branch, page: 1, pageSize: 10 }).items[0]?.sn).toBe('SN-01')
  expect(ctx.inventory.getByProduct(product_id, ctx.branch)[0]?.qty).toBe(1)
})
