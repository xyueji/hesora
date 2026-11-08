import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import type { Database } from 'better-sqlite3'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createImportService } from '../../src/main/services/import/import.service'

let db: Database
let importSvc: ReturnType<typeof createImportService>

beforeEach(() => {
  db = openMemDb()
  importSvc = createImportService(db)
})

const productSvc = () => createProductService(db)

function seedProduct(): number {
  return productSvc().create({
    code: 'P001',
    name: '旧名称',
    base_unit: '罐',
    retail_price: 1,
    trade_price: 1,
    purchase_price: 1,
    tracking_type: 'none',
    units: [],
    barcodes: []
  })
}

describe('import.service', () => {
  it('previews opening inventory without changing stock', () => {
    const productId = seedProduct()
    const result = importSvc.previewOpeningStock('商品编码,数量,成本单价,批次号\nP001,3,2,B01\nP999,4,2')
    expect(result.lines).toEqual([expect.objectContaining({ product_id: productId, qty: 3, unit_cost: 2, batch_no: 'B01' })])
    expect(result.errors).toEqual([{ row: 3, message: '商品不存在：P999' }])
    expect(createInventoryService(db).getByProduct(productId)).toHaveLength(0)
  })

  it('reports invalid optional values without silently replacing them', () => {
    const result = importSvc.importProducts('编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码\nP1,商品,,,件,oops,2,3,,无\nP2,商品,,,件,1,2,3,,未知\nP3,商品,,,件,1,2,3,,无')
    expect(result.created).toBe(1)
    expect(result.errors.map((error) => error.row)).toEqual([2, 3])
  })

  it('reports zero and invalid opening quantities or costs without rolling back valid rows', () => {
    const productId = seedProduct()
    const warehouseId = createWarehouseService(db).create({ name: '主仓', is_default: true })
    const result = importSvc.importOpeningStock('商品编码,数量,成本单价\nP001,0,2\nP001,5,坏值\nP001,3,1', warehouseId)
    expect(result.created).toBe(1)
    expect(result.errors.map((error) => error.row)).toEqual([2, 3])
    expect(createInventoryService(db).getByProduct(productId, warehouseId)[0]?.qty).toBe(3)
  })

  it('importProducts 新建商品', () => {
    const r = importSvc.importProducts('\ufeff编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码\r\nP100,新商品,500ml,饮料,个,5,4,3,10,批次,BC100;BC101\r\n')
    expect(r.errors).toEqual([])
    expect(r.created).toBe(1)
    expect(r.updated).toBe(0)
    const found = productSvc().query({ keyword: 'P100', page: 1, pageSize: 10 }).list[0]
    expect(found?.name).toBe('新商品')
    expect(found?.spec).toBe('500ml')
    expect(found?.category).toBe('饮料')
    expect(found?.min_stock).toBe(10)
    expect(found?.tracking_type).toBe('batch')
    expect(found?.barcodes).toEqual(['BC100', 'BC101'])
  })

  it('importProducts 空的可选列不抹掉已有规格/类别/最低库存', () => {
    const id = seedProduct()
    productSvc().update(id, { spec: '旧规格', category: '旧类别', min_stock: 5 })
    const r = importSvc.importProducts('编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码\r\nP001,新名称,,,罐,2,2,2,,无\r\n')
    expect(r.errors).toEqual([])
    expect(r.updated).toBe(1)
    const found = productSvc().getById(id)
    expect(found?.spec).toBe('旧规格')
    expect(found?.category).toBe('旧类别')
    expect(found?.min_stock).toBe(5)
  })

  it('importProducts 重复条码报行级错误', () => {
    seedProduct()
    productSvc().update(1, { barcodes: ['BC-X'] })
    const r = importSvc.importProducts('编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码\r\nP009,其他,,,个,1,1,1,,无,BC-X\r\n')
    expect(r.created).toBe(0)
    expect(r.errors).toHaveLength(1)
  })

  it('importProducts 更新已有商品（按编码匹配）', () => {
    seedProduct()
    const r = importSvc.importProducts('编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式\r\nP001,新名称,,,瓶,6,5,4,\r\n')
    expect(r.errors).toEqual([])
    expect(r.created).toBe(0)
    expect(r.updated).toBe(1)
    const found = productSvc().query({ keyword: 'P001', page: 1, pageSize: 10 }).list[0]
    expect(found?.name).toBe('新名称')
    expect(found?.base_unit).toBe('瓶')
    expect(found?.retail_price).toBe(6)
  })

  it('importProducts 缺编码/名称报行级错误', () => {
    const r = importSvc.importProducts('编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式\r\n,无名,,,个,1,1,1,\r\nP002,,,,个,1,1,1,\r\n')
    expect(r.created).toBe(0)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toEqual({ row: 2, message: '编码不能为空' })
    expect(r.errors[1]?.row).toBe(3)
  })

  it('importProducts 有效行与无效行混合：有效行仍写入', () => {
    seedProduct()
    const r = importSvc.importProducts(
      '编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式\r\nP001,改名,,,罐,2,2,2,\r\n,缺码,,,个,1,1,1,\r\nP003,有效,,,箱,3,3,3,\r\n'
    )
    expect(r.updated).toBe(1)
    expect(r.created).toBe(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.row).toBe(3)
    expect(productSvc().query({ keyword: 'P003', page: 1, pageSize: 10 }).list[0]?.name).toBe('有效')
  })

  it('importOpeningStock 写入库存与成本', () => {
    const productId = seedProduct()
    const warehouseId = createWarehouseService(db).create({ name: '主仓' } as never)
    const r = importSvc.importOpeningStock('商品编码,数量,成本单价,批次号\r\nP001,100,2.5,B01\r\n', warehouseId)
    expect(r.errors).toEqual([])
    expect(r.created).toBe(1)
    const inv = createInventoryService(db).getByProduct(productId, warehouseId)
    expect(inv).toHaveLength(1)
    expect(inv[0]?.qty).toBe(100)
    expect(inv[0]?.moving_cost).toBe(2.5)
  })

  it('importOpeningStock 负数数量 / 未知商品报行级错误', () => {
    const productId = seedProduct()
    const warehouseId = createWarehouseService(db).create({ name: '主仓' } as never)
    const r = importSvc.importOpeningStock(
      '商品编码,数量,成本单价\r\nP999,10,1\r\nP001,-5,1\r\n',
      warehouseId
    )
    expect(r.created).toBe(0)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]?.row).toBe(2)
    expect(r.errors[0]?.message).toContain('P999')
    expect(r.errors[1]).toEqual({ row: 3, message: '数量不能为负数' })
    expect(createInventoryService(db).getByProduct(productId, warehouseId)).toHaveLength(0)
  })
})
