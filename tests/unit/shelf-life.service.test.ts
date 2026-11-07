import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createShelfLifeService } from '../../src/main/services/product/shelf-life.service'
import { BizError } from '../../src/shared/result'

const base = {
  code: 'P001',
  name: '可乐 330ml',
  base_unit: '罐',
  retail_price: 3,
  trade_price: 2.5,
  purchase_price: 2,
  tracking_type: 'none' as const
}

/** 以今天为基准偏移若干天的 YYYY-MM-DD（本地时区） */
function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('shelf-life.service', () => {
  let db: ReturnType<typeof openMemDb>
  let s: ReturnType<typeof createShelfLifeService>
  let productId: number
  let warehouseId: number

  beforeEach(() => {
    db = openMemDb()
    s = createShelfLifeService(db)
    productId = createProductService(db).create({ ...base })
    warehouseId = Number(
      db.prepare("INSERT INTO warehouse (code, name) VALUES ('WH01', '主仓')").run().lastInsertRowid
    )
  })

  it('setShelfLife persists shelf life days on the product', () => {
    s.setShelfLife(productId, { shelf_life_days: 365, shelf_life_warn_days: 30 })
    const row = db
      .prepare('SELECT shelf_life_days, shelf_life_warn_days FROM product WHERE id = ?')
      .get(productId) as { shelf_life_days: number | null; shelf_life_warn_days: number | null }
    expect(row.shelf_life_days).toBe(365)
    expect(row.shelf_life_warn_days).toBe(30)
  })

  it('setShelfLife rejects negative values and unknown products', () => {
    expect(() => s.setShelfLife(productId, { shelf_life_days: -1 })).toThrowError(BizError)
    expect(() => s.setShelfLife(productId, { shelf_life_warn_days: -5 })).toThrowError(BizError)
    try {
      s.setShelfLife(99999, { shelf_life_days: 10 })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
  })

  it('ensureBatch creates a batch and a repeated call updates the same row', () => {
    const id = s.ensureBatch(productId, warehouseId, 'B20240101', {
      production_date: '2024-01-01',
      expire_date: '2025-01-01',
      remark: '第一批'
    })
    expect(id).toBeGreaterThan(0)

    const id2 = s.ensureBatch(productId, warehouseId, 'B20240101', {
      production_date: '2024-01-02',
      expire_date: '2025-01-02'
    })
    expect(id2).toBe(id)

    const rows = db
      .prepare('SELECT * FROM product_batch WHERE product_id = ? AND batch_no = ?')
      .all(productId, 'B20240101') as { id: number; expire_date: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.expire_date).toBe('2025-01-02')
  })

  it('ensureBatch rejects missing product, missing warehouse and bad dates', () => {
    try {
      s.ensureBatch(99999, warehouseId, 'B1', {})
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
    try {
      s.ensureBatch(productId, 99999, 'B1', {})
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
    expect(() => s.ensureBatch(productId, warehouseId, 'B1', { production_date: '2024/01/01' })).toThrowError(
      BizError
    )
    expect(() => s.ensureBatch(productId, warehouseId, 'B1', { expire_date: '20240101' })).toThrowError(
      BizError
    )
    expect(() =>
      s.ensureBatch(productId, warehouseId, 'B1', {
        production_date: '2024-05-01',
        expire_date: '2024-04-01'
      })
    ).toThrowError(/到期/)
    expect(() => s.ensureBatch(productId, warehouseId, '  ', {})).toThrowError(BizError)
  })

  it('listBatches computes 正常 / 临期 / 已过期 and filters on them', () => {
    s.setShelfLife(productId, { shelf_life_days: 365, shelf_life_warn_days: 30 })
    s.ensureBatch(productId, warehouseId, 'B-NEAR', { expire_date: dateOffset(10) })
    s.ensureBatch(productId, warehouseId, 'B-EXPIRED', { expire_date: dateOffset(-1) })
    s.ensureBatch(productId, warehouseId, 'B-FRESH', { expire_date: dateOffset(120) })

    const all = s.listBatches({ page: 1, pageSize: 20 })
    expect(all.total).toBe(3)
    const byBatch = new Map(all.list.map((b) => [b.batch_no, b]))
    expect(byBatch.get('B-NEAR')?.status).toBe('临期')
    expect(byBatch.get('B-EXPIRED')?.status).toBe('已过期')
    expect(byBatch.get('B-FRESH')?.status).toBe('正常')
    expect(byBatch.get('B-NEAR')?.remaining_days).toBe(10)
    expect(byBatch.get('B-EXPIRED')?.remaining_days).toBe(-1)
    expect(byBatch.get('B-NEAR')?.product_name).toBe('可乐 330ml')
    expect(byBatch.get('B-NEAR')?.warehouse_name).toBe('主仓')

    const expiring = s.listBatches({ page: 1, pageSize: 20, only_expiring: true })
    expect(expiring.total).toBe(1)
    expect(expiring.list[0]?.batch_no).toBe('B-NEAR')

    const expired = s.listBatches({ page: 1, pageSize: 20, only_expired: true })
    expect(expired.total).toBe(1)
    expect(expired.list[0]?.batch_no).toBe('B-EXPIRED')
  })

  it('listBatches falls back to 30 warn days when the product has no warn setting', () => {
    s.ensureBatch(productId, warehouseId, 'B-20', { expire_date: dateOffset(20) })
    s.ensureBatch(productId, warehouseId, 'B-40', { expire_date: dateOffset(40) })
    const list = s.listBatches({ page: 1, pageSize: 20 }).list
    const byBatch = new Map(list.map((b) => [b.batch_no, b]))
    expect(byBatch.get('B-20')?.status).toBe('临期')
    expect(byBatch.get('B-40')?.status).toBe('正常')
  })

  it('listBatches filters by keyword, product and warehouse', () => {
    const other = createProductService(db).create({ ...base, code: 'P002', name: '雪碧' })
    s.ensureBatch(productId, warehouseId, 'B-A', { expire_date: dateOffset(5) })
    s.ensureBatch(other, warehouseId, 'B-B', { expire_date: dateOffset(5) })

    expect(s.listBatches({ page: 1, pageSize: 20, keyword: '雪碧' }).total).toBe(1)
    expect(s.listBatches({ page: 1, pageSize: 20, keyword: 'B-A' }).total).toBe(1)
    expect(s.listBatches({ page: 1, pageSize: 20, product_id: productId }).total).toBe(1)
    expect(s.listBatches({ page: 1, pageSize: 20, warehouse_id: warehouseId }).total).toBe(2)
    expect(s.listBatches({ page: 1, pageSize: 20, warehouse_id: 99999 }).total).toBe(0)
  })

  it('countExpiring counts batches expiring within the given days', () => {
    s.ensureBatch(productId, warehouseId, 'B-5', { expire_date: dateOffset(5) })
    s.ensureBatch(productId, warehouseId, 'B-20', { expire_date: dateOffset(20) })
    s.ensureBatch(productId, warehouseId, 'B-OLD', { expire_date: dateOffset(-3) })
    expect(s.countExpiring(7)).toBe(1)
    expect(s.countExpiring(30)).toBe(2)
    expect(s.countExpiring(0)).toBe(0)
  })
})
