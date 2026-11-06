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
  it('importProducts 新建商品', () => {
    const r = importSvc.importProducts('\ufeff编码,名称,基本单位,零售价,批发价,进价,追踪方式\r\nP100,新商品,个,5,4,3,批次\r\n')
    expect(r.errors).toEqual([])
    expect(r.created).toBe(1)
    expect(r.updated).toBe(0)
    const p = productSvc().getById(r.created ? 0 : 0)
    const found = productSvc().query({ keyword: 'P100', page: 1, pageSize: 10 }).list[0]
    expect(found?.name).toBe('新商品')
    expect(found?.tracking_type).toBe('batch')
    expect(p).toBeDefined()
  })

  it('importProducts 更新已有商品（按编码匹配）', () => {
    seedProduct()
    const r = importSvc.importProducts('编码,名称,基本单位,零售价,批发价,进价\r\nP001,新名称,瓶,6,5,4\r\n')
    expect(r.errors).toEqual([])
    expect(r.created).toBe(0)
    expect(r.updated).toBe(1)
    const found = productSvc().query({ keyword: 'P001', page: 1, pageSize: 10 }).list[0]
    expect(found?.name).toBe('新名称')
    expect(found?.base_unit).toBe('瓶')
    expect(found?.retail_price).toBe(6)
  })

  it('importProducts 缺编码/名称报行级错误', () => {
    const r = importSvc.importProducts('编码,名称,基本单位,零售价,批发价,进价\r\n,无名,个,1,1,1\r\nP002,,个,1,1,1\r\n')
    expect(r.created).toBe(0)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toEqual({ row: 2, message: '编码不能为空' })
    expect(r.errors[1]?.row).toBe(3)
  })

  it('importProducts 有效行与无效行混合：有效行仍写入', () => {
    seedProduct()
    const r = importSvc.importProducts(
      '编码,名称,基本单位,零售价,批发价,进价\r\nP001,改名,罐,2,2,2\r\n,缺码,个,1,1,1\r\nP003,有效,箱,3,3,3\r\n'
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
