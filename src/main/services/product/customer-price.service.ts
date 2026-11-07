import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
export type {
  CustomerPriceRow,
  PriceChangeLogRow,
  ChangeLogQuery
} from '../../../shared/types/customer-price'
import type {
  CustomerPriceRow,
  PriceChangeLogRow,
  ChangeLogQuery
} from '../../../shared/types/customer-price'

export type DB = Database

export interface ResolvePriceInput {
  customer_id?: number | null
  product_id: number
  /** 客户的价格等级（customer.price_level），不传则跳过等级价 */
  price_level?: string | null
}

/** 统一规整价格：必须是 >= 0 的有限数字 */
function normalizePrice(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') {
    throw new BizError('VALIDATION', '价格不能为空')
  }
  const price = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(price) || price < 0) {
    throw new BizError('VALIDATION', '价格必须是不小于 0 的数字')
  }
  return price
}

/**
 * 客户×商品专属价服务 + 变价记录。
 * 取价优先级（resolvePrice）：专属价 > 客户 price_level 对应等级价 > 商品零售价。
 */
export function createCustomerPriceService(db: DB) {
  const selectProduct = db.prepare('SELECT id, retail_price FROM product WHERE id = ?')
  const selectCustomer = db.prepare('SELECT id, price_level FROM customer WHERE id = ?')
  const selectOne = db.prepare(
    'SELECT id, customer_id, product_id, price, updated_at FROM customer_product_price WHERE customer_id = ? AND product_id = ?'
  )
  const insert = db.prepare(
    'INSERT INTO customer_product_price (customer_id, product_id, price) VALUES (?, ?, ?)'
  )
  const update = db.prepare(
    "UPDATE customer_product_price SET price = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  )
  const remove = db.prepare('DELETE FROM customer_product_price WHERE id = ?')
  const insertLog = db.prepare(
    'INSERT INTO price_change_log (scope, customer_id, product_id, old_price, new_price, operator) VALUES (?, ?, ?, ?, ?, ?)'
  )

  function requireProduct(productId: number): { id: number; retail_price: number } {
    const row = selectProduct.get(productId) as { id: number; retail_price: number } | undefined
    if (!row) throw new BizError('NOT_FOUND', `商品不存在：${productId}`)
    return row
  }

  function requireCustomer(customerId: number): { id: number; price_level: string | null } {
    const row = selectCustomer.get(customerId) as { id: number; price_level: string | null } | undefined
    if (!row) throw new BizError('NOT_FOUND', `客户不存在：${customerId}`)
    return row
  }

  return {
    /** 设置（新建或覆盖）某客户某商品的专属价，并写变价记录（同价不记日志） */
    setPrice(customerId: number, productId: number, rawPrice: unknown, operator?: string | null): CustomerPriceRow {
      requireCustomer(customerId)
      const product = requireProduct(productId)
      const price = normalizePrice(rawPrice)
      let row: CustomerPriceRow
      db.transaction(() => {
        const existing = selectOne.get(customerId, productId) as CustomerPriceRow | undefined
        if (existing) {
          update.run(price, existing.id)
          if (existing.price !== price) {
            insertLog.run('customer_product', customerId, productId, existing.price, price, operator ?? null)
          }
        } else {
          insert.run(customerId, productId, price)
          insertLog.run('customer_product', customerId, productId, product.retail_price, price, operator ?? null)
        }
        row = selectOne.get(customerId, productId) as CustomerPriceRow
      })()
      return row!
    },

    /** 删除某客户某商品的专属价（无记录时静默成功） */
    removePrice(customerId: number, productId: number): void {
      db.transaction(() => {
        const existing = selectOne.get(customerId, productId) as CustomerPriceRow | undefined
        if (existing) remove.run(existing.id)
      })()
    },

    /** 某客户的全部专属价列表 */
    listByCustomer(customerId: number): CustomerPriceRow[] {
      return db
        .prepare(
          'SELECT id, customer_id, product_id, price, updated_at FROM customer_product_price WHERE customer_id = ? ORDER BY product_id'
        )
        .all(customerId) as CustomerPriceRow[]
    },

    /** 某商品在全部客户下的专属价列表 */
    listByProduct(productId: number): CustomerPriceRow[] {
      return db
        .prepare(
          'SELECT id, customer_id, product_id, price, updated_at FROM customer_product_price WHERE product_id = ? ORDER BY customer_id'
        )
        .all(productId) as CustomerPriceRow[]
    },

    /** 变价历史，可按客户/商品/范围过滤，新记录在前 */
    changeLog(query: ChangeLogQuery = {}): PriceChangeLogRow[] {
      const where: string[] = []
      const params: (number | string)[] = []
      if (query.customer_id !== undefined && query.customer_id !== null) {
        where.push('customer_id = ?')
        params.push(query.customer_id)
      }
      if (query.product_id !== undefined && query.product_id !== null) {
        where.push('product_id = ?')
        params.push(query.product_id)
      }
      if (query.scope) {
        where.push('scope = ?')
        params.push(query.scope)
      }
      const sql = `SELECT id, scope, customer_id, product_id, old_price, new_price, operator, created_at
        FROM price_change_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY id DESC`
      return db.prepare(sql).all(...params) as PriceChangeLogRow[]
    }
  }
}

export type CustomerPriceService = ReturnType<typeof createCustomerPriceService>

/**
 * 统一取价入口（销售/报价等单据明细默认价）。
 * 优先级：客户×商品专属价 > 客户 price_level 对应 product_price 等级价 > 商品零售价。
 * 商品不存在时抛 NOT_FOUND；专属价/等级价未维护时逐级回退。
 */
export function resolvePrice(db: DB, input: ResolvePriceInput): number {
  const product = db.prepare('SELECT id, retail_price FROM product WHERE id = ?').get(input.product_id) as
    | { id: number; retail_price: number }
    | undefined
  if (!product) throw new BizError('NOT_FOUND', `商品不存在：${input.product_id}`)

  const customerId = input.customer_id ?? null
  if (customerId !== null) {
    const special = db
      .prepare('SELECT price FROM customer_product_price WHERE customer_id = ? AND product_id = ?')
      .get(customerId, input.product_id) as { price: number } | undefined
    if (special) return special.price

    const level =
      input.price_level ??
      (db.prepare('SELECT price_level FROM customer WHERE id = ?').get(customerId) as
        | { price_level: string | null }
        | undefined)?.price_level ??
      null
    if (typeof level === 'string' && level.trim() !== '') {
      const lvl = db
        .prepare('SELECT price FROM product_price WHERE product_id = ? AND price_level = ?')
        .get(input.product_id, level.trim()) as { price: number } | undefined
      if (lvl) return lvl.price
    }
  }
  return product.retail_price
}
