import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { BizError } from '../../src/shared/result'

const svc = () => createProductService(openMemDb())

const base = {
  code: 'P001',
  name: '可乐 330ml',
  base_unit: '罐',
  retail_price: 3,
  trade_price: 2.5,
  purchase_price: 2,
  tracking_type: 'none' as const
}

describe('product.service', () => {
  let s: ReturnType<typeof createProductService>
  beforeEach(() => {
    s = svc()
  })

  it('create returns id and auto-manages units/barcodes', () => {
    const id = s.create({ ...base, units: [{ unit: '箱', rate: 24 }], barcodes: ['6901234567890'] })
    const got = s.getById(id)
    expect(got?.name).toBe('可乐 330ml')
    expect(got?.units).toHaveLength(1)
    expect(got?.barcodes).toEqual(['6901234567890'])
  })

  it('duplicate code throws BizError DUP_CODE', () => {
    s.create(base)
    try {
      s.create(base)
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('DUP_CODE')
    }
  })

  it('update replaces units/barcodes atomically', () => {
    const id = s.create({ ...base, barcodes: ['a'] })
    s.update(id, { name: '可乐 500ml', barcodes: ['b'] })
    expect(s.getById(id)?.name).toBe('可乐 500ml')
    expect(s.getById(id)?.barcodes).toEqual(['b'])
  })

  it('disable/enable and delete forbidden', () => {
    const id = s.create(base)
    s.disable(id)
    expect(s.getById(id)?.disabled).toBe(true)
    expect(() => s.remove(id)).toThrow()
    s.enable(id)
    expect(s.getById(id)?.disabled).toBe(false)
  })

  it('query paginates with keyword on code/name/barcode', () => {
    s.create(base)
    s.create({ ...base, code: 'P002', name: '雪碧' })
    expect(s.query({ page: 1, pageSize: 1, keyword: '雪碧' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10, keyword: 'P001' }).list[0]!.code).toBe('P001')
  })

  it('validation rejects empty code/name/base_unit', () => {
    expect(() => s.create({ ...base, code: '' })).toThrow()
    expect(() => s.create({ ...base, code: 'X', name: '  ' })).toThrow()
    expect(() => s.create({ ...base, code: 'X', name: 'n', base_unit: '' })).toThrow()
  })

  it('images are stored and parsed back', () => {
    const id = s.create({ ...base, images: ['a.png', 'b.png'] })
    expect(s.getById(id)?.images).toEqual(['a.png', 'b.png'])
    const id2 = s.create({ ...base, code: 'P002' })
    expect(s.getById(id2)?.images).toEqual([])
  })

  it('query keyword matches barcode and respects includeDisabled', () => {
    const id = s.create({ ...base, barcodes: ['BC1'] })
    expect(s.query({ page: 1, pageSize: 10, keyword: 'BC1' }).total).toBe(1)
    s.disable(id)
    expect(s.query({ page: 1, pageSize: 10 }).total).toBe(0)
    expect(s.query({ page: 1, pageSize: 10, includeDisabled: true }).total).toBe(1)
  })

  it('looks up the exact active product by barcode', () => {
    const id = s.create({ ...base, barcodes: ['12345'] })
    s.create({ ...base, code: 'P002', barcodes: ['123456'] })
    expect(s.getByBarcode(' 12345 ')?.id).toBe(id)
    expect(s.getByBarcode('1234')).toBeNull()
    s.disable(id)
    expect(s.getByBarcode('12345')).toBeNull()
  })

  it('update duplicate code throws DUP_CODE', () => {
    s.create(base)
    const id2 = s.create({ ...base, code: 'P002' })
    expect(() => s.update(id2, { code: 'P001' })).toThrow()
  })

  it('create combo with bom and getById returns kind + bom', () => {
    const childId = s.create(base)
    const comboId = s.create({
      ...base,
      code: 'C001',
      name: '礼盒',
      kind: 'combo',
      bom: [{ product_id: childId, qty: 2 }]
    })
    const got = s.getById(comboId)
    expect(got?.kind).toBe('combo')
    expect(got?.bom).toEqual([{ product_id: childId, qty: 2 }])
    const child = s.getById(childId)
    expect(child?.kind).toBe('standard')
    expect(child?.bom).toBeUndefined()
  })

  it('combo without bom is rejected (create and update)', () => {
    expect(() => s.create({ ...base, code: 'C002', kind: 'combo', bom: [] })).toThrowError(BizError)
    const childId = s.create(base)
    const comboId = s.create({
      ...base,
      code: 'C003',
      kind: 'combo',
      bom: [{ product_id: childId, qty: 1 }]
    })
    expect(() => s.update(comboId, { bom: [] })).toThrowError(BizError)
  })

  it('update replaces bom and validates children', () => {
    const a = s.create(base)
    const b = s.create({ ...base, code: 'P003' })
    const comboId = s.create({
      ...base,
      code: 'C004',
      kind: 'combo',
      bom: [{ product_id: a, qty: 1 }]
    })
    s.update(comboId, { bom: [{ product_id: b, qty: 3 }] })
    expect(s.getById(comboId)?.bom).toEqual([{ product_id: b, qty: 3 }])
    expect(() => s.update(comboId, { bom: [{ product_id: 99999, qty: 1 }] })).toThrowError(/子件商品不存在/)
    expect(() => s.update(comboId, { bom: [{ product_id: a, qty: 0 }] })).toThrowError(/大于0/)
    // 标准商品不能作为子件换成另一个组合商品
    const combo2 = s.create({
      ...base,
      code: 'C005',
      kind: 'combo',
      bom: [{ product_id: a, qty: 1 }]
    })
    expect(() => s.update(combo2, { bom: [{ product_id: comboId, qty: 1 }] })).toThrowError(/标准商品/)
  })

  it('query supports kind filter', () => {
    const childId = s.create(base)
    s.create({ ...base, code: 'C006', kind: 'combo', bom: [{ product_id: childId, qty: 1 }] })
    expect(s.query({ page: 1, pageSize: 10, kind: 'combo' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10, kind: 'standard' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10 }).total).toBe(2)
  })

  it('create keeps shelf life days and price levels', () => {
    const id = s.create({
      ...base,
      shelf_life_days: 365,
      shelf_life_warn_days: 30,
      price_levels: [
        { price_level: '零售价', price: 3 },
        { price_level: '批发价', price: 2.5 }
      ]
    })
    const got = s.getById(id)
    expect(got?.shelf_life_days).toBe(365)
    expect(got?.shelf_life_warn_days).toBe(30)
    expect(got?.price_levels).toEqual([
      { price_level: '零售价', price: 3 },
      { price_level: '批发价', price: 2.5 }
    ])
  })

  it('update replaces price levels and shelf life columns', () => {
    const id = s.create({
      ...base,
      shelf_life_days: 365,
      price_levels: [{ price_level: '零售价', price: 3 }]
    })
    s.update(id, {
      shelf_life_days: 180,
      shelf_life_warn_days: 15,
      price_levels: [{ price_level: '会员价', price: 2.8 }]
    })
    const got = s.getById(id)
    expect(got?.shelf_life_days).toBe(180)
    expect(got?.shelf_life_warn_days).toBe(15)
    expect(got?.price_levels).toEqual([{ price_level: '会员价', price: 2.8 }])
  })

  it('product without price levels returns an empty level list', () => {
    const id = s.create(base)
    expect(s.getById(id)?.price_levels).toEqual([])
    expect(s.getById(id)?.shelf_life_days).toBeUndefined()
  })

  it('T8 双审 M2: bulkUpdate logs given operator instead of hardcoded system', () => {
    const db = openMemDb()
    const ps = createProductService(db)
    const pid = ps.create({
      code: 'P-BULK', name: '批量', base_unit: '件', retail_price: 1, trade_price: 1,
      purchase_price: 1, tracking_type: 'none', units: [], barcodes: []
    })
    ps.bulkUpdate([pid], { retail_price: 9.9 }, '张三')
    const log = db.prepare(
      "SELECT operator FROM platform_log WHERE action = 'product.bulk_update' ORDER BY id DESC LIMIT 1"
    ).get() as { operator: string }
    expect(log.operator).toBe('张三')
  })
})

