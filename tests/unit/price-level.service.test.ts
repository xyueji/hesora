import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createPriceLevelService } from '../../src/main/services/product/price-level.service'
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

describe('price-level.service', () => {
  let db: ReturnType<typeof openMemDb>
  let s: ReturnType<typeof createPriceLevelService>
  let productId: number

  beforeEach(() => {
    db = openMemDb()
    s = createPriceLevelService(db)
    productId = createProductService(db).create({ ...base })
  })

  it('setLevels replaces the whole level set of a product', () => {
    s.setLevels(productId, [
      { price_level: '零售价', price: 3 },
      { price_level: '批发价', price: 2.5 }
    ])
    expect(s.getLevels(productId)).toEqual([
      { price_level: '零售价', price: 3 },
      { price_level: '批发价', price: 2.5 }
    ])

    // 再次保存 = 整体替换，旧等级不保留
    s.setLevels(productId, [{ price_level: '会员价', price: 2.8 }])
    expect(s.getLevels(productId)).toEqual([{ price_level: '会员价', price: 2.8 }])
  })

  it('setLevels rejects duplicated level names and keeps old rows untouched', () => {
    s.setLevels(productId, [{ price_level: '零售价', price: 3 }])
    expect(() =>
      s.setLevels(productId, [
        { price_level: '批发价', price: 2.5 },
        { price_level: '批发价', price: 2 }
      ])
    ).toThrowError(BizError)
    try {
      s.setLevels(productId, [
        { price_level: '批发价', price: 2.5 },
        { price_level: '批发价', price: 2 }
      ])
    } catch (e) {
      expect((e as BizError).code).toBe('VALIDATION')
    }
    // 事务回滚：原数据保持不变
    expect(s.getLevels(productId)).toEqual([{ price_level: '零售价', price: 3 }])
  })

  it('setLevels rejects empty level name and invalid price', () => {
    expect(() => s.setLevels(productId, [{ price_level: '  ', price: 1 }])).toThrowError(BizError)
    expect(() => s.setLevels(productId, [{ price_level: '零售价', price: -1 }])).toThrowError(BizError)
    expect(() => s.setLevels(productId, [{ price_level: '零售价', price: Number.NaN }])).toThrowError(BizError)
    try {
      s.setLevels(productId, [{ price_level: '零售价', price: -0.01 }])
    } catch (e) {
      expect((e as BizError).code).toBe('VALIDATION')
    }
    expect(s.getLevels(productId)).toEqual([])
  })

  it('setLevels throws NOT_FOUND when the product does not exist', () => {
    try {
      s.setLevels(99999, [{ price_level: '零售价', price: 1 }])
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
  })

  it('resolvePrice picks the price of the requested level', () => {
    s.setLevels(productId, [
      { price_level: '零售价', price: 3 },
      { price_level: '批发价', price: 2.5 }
    ])
    expect(s.resolvePrice(productId, '批发价')).toBe(2.5)
    expect(s.resolvePrice(productId, '零售价')).toBe(3)
  })

  it('resolvePrice falls back to retail_price for unknown or empty level', () => {
    s.setLevels(productId, [{ price_level: '批发价', price: 2.5 }])
    expect(s.resolvePrice(productId, '不存在的等级')).toBe(3)
    expect(s.resolvePrice(productId, '')).toBe(3)
    expect(s.resolvePrice(productId)).toBe(3)
  })

  it('resolvePrice falls back to retail_price when no level row exists', () => {
    expect(s.resolvePrice(productId, '批发价')).toBe(3)
  })

  it('priceLevelsFor exposes the level list of a product', () => {
    s.setLevels(productId, [{ price_level: '会员价', price: 2.8 }])
    expect(s.priceLevelsFor(productId)).toEqual([{ price_level: '会员价', price: 2.8 }])
    expect(s.priceLevelsFor(99999)).toEqual([])
  })
})
