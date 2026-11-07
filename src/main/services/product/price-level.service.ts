import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PriceLevel } from '../../../shared/types/product'

export type DB = Database

/** 写入价格等级时的入参（与 PriceLevel 同形，便于 IPC 直传） */
export interface PriceLevelInput {
  price_level: string
  price: number
}

interface ProductPriceRow {
  id: number
  product_id: number
  price_level: string
  price: number
}

interface ProductRow {
  id: number
  retail_price: number
}

/**
 * 校验并规整价格等级列表。
 * 规则：等级名非空；价格必须是 >= 0 的有限数字；同一商品内等级名不得重复。
 * 供 price-level.service 与 product.service 共用，避免两处规则漂移。
 */
export function normalizePriceLevels(levels: unknown): PriceLevel[] {
  if (!Array.isArray(levels)) {
    throw new BizError('VALIDATION', '价格等级列表格式不正确')
  }
  const seen = new Set<string>()
  const result: PriceLevel[] = []
  for (const item of levels) {
    if (typeof item !== 'object' || item === null) {
      throw new BizError('VALIDATION', '价格等级格式不正确')
    }
    const rec = item as Record<string, unknown>
    const rawLevel = rec['price_level']
    if (typeof rawLevel !== 'string' || rawLevel.trim() === '') {
      throw new BizError('VALIDATION', '价格等级名称不能为空')
    }
    const level = rawLevel.trim()
    if (seen.has(level)) {
      throw new BizError('VALIDATION', `价格等级重复：${level}`)
    }
    seen.add(level)
    const rawPrice = rec['price']
    if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
      throw new BizError('VALIDATION', `价格等级「${level}」的价格不能为空`)
    }
    const price = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice)
    if (!Number.isFinite(price) || price < 0) {
      throw new BizError('VALIDATION', `价格等级「${level}」的价格必须是不小于 0 的数字`)
    }
    result.push({ price_level: level, price })
  }
  return result
}

/**
 * 价格等级服务：按商品维护多档价格（零售价/批发价/会员价…），
 * 并在缺少对应等级行时回退到商品零售价。
 */
export function createPriceLevelService(db: DB) {
  const selectProduct = db.prepare('SELECT id, retail_price FROM product WHERE id = ?')
  const selectLevels = db.prepare(
    'SELECT id, product_id, price_level, price FROM product_price WHERE product_id = ? ORDER BY id'
  )
  const selectLevel = db.prepare(
    'SELECT id, product_id, price_level, price FROM product_price WHERE product_id = ? AND price_level = ?'
  )
  const deleteLevels = db.prepare('DELETE FROM product_price WHERE product_id = ?')
  const insertLevel = db.prepare(
    'INSERT INTO product_price (product_id, price_level, price) VALUES (?, ?, ?)'
  )

  function requireProduct(productId: number): ProductRow {
    const row = selectProduct.get(productId) as ProductRow | undefined
    if (!row) throw new BizError('NOT_FOUND', `商品不存在：${productId}`)
    return row
  }

  function getLevels(productId: number): PriceLevel[] {
    const rows = selectLevels.all(productId) as ProductPriceRow[]
    return rows.map((r) => ({ price_level: r.price_level, price: r.price }))
  }

  return {
    /** 整体替换某商品的价格等级（一次事务，先删后写） */
    setLevels(productId: number, levels: readonly PriceLevelInput[]): void {
      requireProduct(productId)
      const normalized = normalizePriceLevels(levels as unknown)
      db.transaction(() => {
        deleteLevels.run(productId)
        for (const item of normalized) {
          insertLevel.run(productId, item.price_level, item.price)
        }
      })()
    },

    /** 读取某商品的全部价格等级 */
    getLevels,

    /**
     * 取价：给定等级返回该等级价格；
     * 等级为空、未知或未维护对应等级行时回退到商品零售价。
     */
    resolvePrice(productId: number, priceLevel?: string | null): number {
      const product = requireProduct(productId)
      const level = typeof priceLevel === 'string' ? priceLevel.trim() : ''
      if (level === '') return product.retail_price
      const row = selectLevel.get(productId, level) as ProductPriceRow | undefined
      return row ? row.price : product.retail_price
    },

    /** 供渲染层使用的价格等级读取入口（与 getLevels 等价） */
    priceLevelsFor(productId: number): PriceLevel[] {
      return getLevels(productId)
    }
  }
}

export type PriceLevelService = ReturnType<typeof createPriceLevelService>
