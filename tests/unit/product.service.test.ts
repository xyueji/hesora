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

  it('update duplicate code throws DUP_CODE', () => {
    s.create(base)
    const id2 = s.create({ ...base, code: 'P002' })
    expect(() => s.update(id2, { code: 'P001' })).toThrow()
  })
})
