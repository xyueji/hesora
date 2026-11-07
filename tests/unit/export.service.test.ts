import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import type { Database } from 'better-sqlite3'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createExportService } from '../../src/main/services/export/export.service'

let db: Database
let exportSvc: ReturnType<typeof createExportService>

beforeEach(() => {
  db = openMemDb()
  exportSvc = createExportService(db)
})

function seedBasics(): { productId: number; warehouseId: number } {
  const p = createProductService(db)
  const w = createWarehouseService(db)
  const productId = p.create({
    code: 'P001',
    name: '可乐,330ml',
    base_unit: '罐',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'batch',
    units: [{ unit: '箱', rate: 24 }],
    barcodes: []
  })
  const warehouseId = w.create({ name: '主仓', is_default: true } as never)
  return { productId, warehouseId }
}

describe('export.service', () => {
  it('products 导出含 BOM、转义逗号、单位换算', () => {
    seedBasics()
    const csv = exportSvc.products()
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('编码,名称,基本单位,零售价,批发价,进价,追踪方式,商品类型,停用')
    expect(csv).toContain('"可乐,330ml"')
    expect(csv).toContain(',batch,')
    expect(csv).toContain('标准商品')
  })

  it('customers / suppliers 导出表头与数据', () => {
    const c = createCustomerService(db)
    const s = createSupplierService(db)
    c.create({ code: 'C001', name: '客户甲', opening_receivable: 100 } as never)
    s.create({ code: 'S001', name: '供应商乙', opening_payable: 50 } as never)
    const ccsv = exportSvc.customers()
    expect(ccsv).toContain('编码,名称,联系人,电话,地址,价格等级,期初应收,信用额度,备注,停用')
    expect(ccsv).toContain('客户甲')
    const scsv = exportSvc.suppliers()
    expect(scsv).toContain('编码,名称,联系人,电话,地址,期初应付,备注,停用')
    expect(scsv).toContain('供应商乙')
  })

  it('stock 导出复用 queryStock', () => {
    const { productId, warehouseId } = seedBasics()
    createInventoryService(db).applyChanges([
      { product_id: productId, warehouse_id: warehouseId, batch_no: 'B01', change_qty: 10, unit_cost: 2, source: 'test' }
    ])
    const csv = exportSvc.stock()
    expect(csv).toContain('商品编码,商品名称,规格,单位,仓库,批次,数量,成本单价,金额')
    expect(csv).toContain('P001')
    expect(csv).toContain('B01')
  })

  it('stock 按 warehouse_id 过滤', () => {
    const { productId, warehouseId } = seedBasics()
    const w = createWarehouseService(db)
    const w2 = w.create({ name: '次仓' } as never)
    const inv = createInventoryService(db)
    inv.applyChanges([
      { product_id: productId, warehouse_id: warehouseId, batch_no: 'B01', change_qty: 5, unit_cost: 1, source: 'test' },
      { product_id: productId, warehouse_id: w2, batch_no: 'B01', change_qty: 7, unit_cost: 1, source: 'test' }
    ])
    const csv = exportSvc.stock(warehouseId)
    expect(csv).toContain('主仓')
    expect(csv).not.toContain('次仓')
  })

  it('docs 导出单据明细（一行一明细）', () => {
    const { productId, warehouseId } = seedBasics()
    const purchase = createPurchaseService(db)
    const doc = purchase.create({
      type: 'purchase',
      date: '2026-11-07',
      warehouse_id: warehouseId,
      items: [{ product_id: productId, qty: 10, price: 2, batch_no: 'B01' }]
    } as never)
    expect(doc).toBeTruthy()
    const csv = exportSvc.docs('purchase', '2026-11-01', '2026-11-30')
    expect(csv).toContain('单号,日期,类型,商品编码,商品名称,单位,数量,单价,金额')
    expect(csv).toContain('P001')
    expect(csv).toContain('2026-11-07')
    // 日期过滤排除
    const csvNone = exportSvc.docs('purchase', '2027-01-01')
    expect(csvNone.split('\r\n')).toHaveLength(2) // BOM 行 + 表头行
  })

  it('exports the quantity in the same unit as the document line', () => {
    const { productId, warehouseId } = seedBasics()
    createPurchaseService(db).create({ warehouse_id: warehouseId, items: [{ product_id: productId, unit: '箱', qty: 2, rate: 24, price: 30, batch_no: 'B01' }] })
    expect(exportSvc.docs('purchase')).toContain(',箱,2,30,60')
  })
})
