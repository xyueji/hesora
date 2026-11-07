import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { BatchStatus, ProductBatch, ShelfLifeConfig } from '../../../shared/types/product'

export type DB = Database

/** 未设置预警天数时的默认临期提前天数 */
export const DEFAULT_WARN_DAYS = 30

/** 批次效期入参（均为可选，缺省表示不改动已存在的数据） */
export interface BatchInput {
  production_date?: string | null
  expire_date?: string | null
  remark?: string | null
}

/** 批次查询条件 */
export interface BatchQuery {
  page: number
  pageSize: number
  keyword?: string
  product_id?: number
  warehouse_id?: number
  only_expiring?: boolean
  only_expired?: boolean
}

interface ProductRow {
  id: number
  shelf_life_days: number | null
  shelf_life_warn_days: number | null
}

interface BatchRow {
  id: number
  product_id: number
  warehouse_id: number
  batch_no: string
  production_date: string | null
  expire_date: string | null
  remark: string | null
  product_code: string
  product_name: string
  warehouse_name: string
  warn_days: number | null
  remaining_days: number | null
  status: BatchStatus
}

/** 本地时区的今天，格式 YYYY-MM-DD */
export function todayDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 校验 YYYY-MM-DD 且必须是真实存在的日期 */
export function isValidDateText(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const parts = text.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 在 YYYY-MM-DD 上加天数 */
function addDays(dateText: string, days: number): string {
  const parts = dateText.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  const dt = new Date(y, m - 1, d + days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function requireDays(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new BizError('VALIDATION', `${field}必须是不小于 0 的整数`)
  }
  return n
}

function normalizeDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !isValidDateText(value.trim())) {
    throw new BizError('VALIDATION', `${field}格式必须是 YYYY-MM-DD`)
  }
  return value.trim()
}

/**
 * 保质期 / 批次效期服务。
 * - 商品主档：保质期天数 + 临期预警提前天数；
 * - 批次：商品 + 仓库 + 批次号 唯一，记录生产日期与到期日期；
 * - 查询：按剩余天数计算 正常 / 临期 / 已过期，并支持按状态、关键字、商品、仓库过滤。
 */
export function createShelfLifeService(db: DB) {
  const selectProduct = db.prepare(
    'SELECT id, shelf_life_days, shelf_life_warn_days FROM product WHERE id = ?'
  )
  const selectWarehouse = db.prepare('SELECT id FROM warehouse WHERE id = ?')
  const updateShelfLife = db.prepare(
    'UPDATE product SET shelf_life_days = @shelf_life_days, shelf_life_warn_days = @shelf_life_warn_days, updated_at = datetime(\'now\',\'localtime\') WHERE id = @id'
  )
  const selectBatch = db.prepare(
    'SELECT id FROM product_batch WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )
  const insertBatch = db.prepare(`
    INSERT INTO product_batch (product_id, warehouse_id, batch_no, production_date, expire_date, remark)
    VALUES (@product_id, @warehouse_id, @batch_no, @production_date, @expire_date, @remark)
  `)
  const updateBatch = db.prepare(`
    UPDATE product_batch
    SET production_date = COALESCE(@production_date, production_date),
        expire_date = COALESCE(@expire_date, expire_date),
        remark = COALESCE(@remark, remark)
    WHERE id = @id
  `)

  function requireProduct(productId: number): ProductRow {
    const row = selectProduct.get(productId) as ProductRow | undefined
    if (!row) throw new BizError('NOT_FOUND', `商品不存在：${productId}`)
    return row
  }

  function requireWarehouse(warehouseId: number): void {
    const row = selectWarehouse.get(warehouseId) as { id: number } | undefined
    if (!row) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
  }

  /**
   * 写入保质期设置。shelf_life_days / shelf_life_warn_days 为 undefined 时保持原值，
   * 传 null 表示清空该字段。
   */
  function setShelfLife(productId: number, config: ShelfLifeConfig): void {
    const product = requireProduct(productId)
    const days =
      config.shelf_life_days === undefined
        ? (product.shelf_life_days ?? null)
        : config.shelf_life_days === null
          ? null
          : requireDays(config.shelf_life_days, '保质期天数')
    const warn =
      config.shelf_life_warn_days === undefined
        ? (product.shelf_life_warn_days ?? null)
        : config.shelf_life_warn_days === null
          ? null
          : requireDays(config.shelf_life_warn_days, '预警提前天数')
    db.transaction(() => {
      updateShelfLife.run({ id: productId, shelf_life_days: days, shelf_life_warn_days: warn })
    })()
  }

  /**
   * 登记/更新批次效期。同一 (商品, 仓库, 批次号) 视为同一条记录，重复调用即更新。
   * 未给到期日期但给了生产日期、且商品设置了保质期天数时，自动推算到期日期。
   * 返回批次记录 id。
   */
  function ensureBatch(
    productId: number,
    warehouseId: number,
    batchNo: string,
    input: BatchInput = {}
  ): number {
    const product = requireProduct(productId)
    requireWarehouse(warehouseId)
    const batch = typeof batchNo === 'string' ? batchNo.trim() : ''
    if (batch === '') throw new BizError('VALIDATION', '批次号不能为空')

    const production = normalizeDate(input.production_date, '生产日期')
    let expire = normalizeDate(input.expire_date, '到期日期')
    if (expire === null && production !== null && product.shelf_life_days !== null) {
      expire = addDays(production, product.shelf_life_days)
    }
    if (production !== null && expire !== null && expire < production) {
      throw new BizError('VALIDATION', '到期日期不能早于生产日期')
    }
    const remark = typeof input.remark === 'string' && input.remark.trim() !== '' ? input.remark.trim() : null

    let id = 0
    db.transaction(() => {
      const existing = selectBatch.get(productId, warehouseId, batch) as { id: number } | undefined
      if (existing) {
        id = existing.id
        updateBatch.run({
          id: existing.id,
          production_date: production,
          expire_date: expire,
          remark
        })
      } else {
        id = Number(
          insertBatch.run({
            product_id: productId,
            warehouse_id: warehouseId,
            batch_no: batch,
            production_date: production,
            expire_date: expire,
            remark
          }).lastInsertRowid
        )
      }
    })()
    return id
  }

  /** 批次列表：带剩余天数与状态，并支持分页与过滤 */
  function listBatches(query: BatchQuery): { list: ProductBatch[]; total: number } {
    const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize) || 20), 1), 200)
    const page = Math.max(Math.trunc(Number(query.page) || 1), 1)
    const today = todayDate()

    const where: string[] = []
    const params: Record<string, unknown> = { today }
    if (query.keyword) {
      where.push(
        '(b.batch_no LIKE @kw OR p.code LIKE @kw OR p.name LIKE @kw OR w.name LIKE @kw)'
      )
      params['kw'] = `%${query.keyword}%`
    }
    if (query.product_id) {
      where.push('b.product_id = @product_id')
      params['product_id'] = Number(query.product_id)
    }
    if (query.warehouse_id) {
      where.push('b.warehouse_id = @warehouse_id')
      params['warehouse_id'] = Number(query.warehouse_id)
    }
    const baseWhere = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const statusExpr = `
      CASE
        WHEN b.expire_date IS NULL THEN '正常'
        WHEN b.expire_date < @today THEN '已过期'
        WHEN CAST(julianday(b.expire_date) - julianday(@today) AS INTEGER) <= COALESCE(p.shelf_life_warn_days, ${DEFAULT_WARN_DAYS}) THEN '临期'
        ELSE '正常'
      END`
    const remainExpr = `
      CASE WHEN b.expire_date IS NULL THEN NULL
           ELSE CAST(julianday(b.expire_date) - julianday(@today) AS INTEGER) END`

    const statusWhere: string[] = []
    if (query.only_expiring && query.only_expired) {
      statusWhere.push(`status IN ('临期','已过期')`)
    } else if (query.only_expiring) {
      statusWhere.push(`status = '临期'`)
    } else if (query.only_expired) {
      statusWhere.push(`status = '已过期'`)
    }
    const statusSql = statusWhere.length > 0 ? `WHERE ${statusWhere.join(' AND ')}` : ''

    const cte = `
      WITH base AS (
        SELECT b.id, b.product_id, b.warehouse_id, b.batch_no, b.production_date, b.expire_date, b.remark,
               p.code AS product_code, p.name AS product_name, p.shelf_life_warn_days AS warn_days,
               w.name AS warehouse_name,
               ${statusExpr} AS status,
               ${remainExpr} AS remaining_days
        FROM product_batch b
        JOIN product p ON p.id = b.product_id
        JOIN warehouse w ON w.id = b.warehouse_id
        ${baseWhere}
      )`

    const total = Number(
      (db.prepare(`${cte} SELECT COUNT(*) AS c FROM base ${statusSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(
        `${cte} SELECT * FROM base ${statusSql}
         ORDER BY (expire_date IS NULL), expire_date ASC, id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as BatchRow[]

    const list: ProductBatch[] = rows.map((r) => ({
      id: r.id,
      product_id: r.product_id,
      warehouse_id: r.warehouse_id,
      batch_no: r.batch_no,
      production_date: r.production_date ?? undefined,
      expire_date: r.expire_date ?? undefined,
      remark: r.remark ?? undefined,
      product_code: r.product_code,
      product_name: r.product_name,
      warehouse_name: r.warehouse_name,
      remaining_days: r.remaining_days,
      status: r.status
    }))
    return { list, total }
  }

  /** 预警统计：未来 days 天内到期的批次数（不含已过期批次） */
  function countExpiring(days: number): number {
    const limit = Math.max(Math.trunc(Number(days) || 0), 0)
    const today = todayDate()
    const until = addDays(today, limit)
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM product_batch
         WHERE expire_date IS NOT NULL AND expire_date >= @today AND expire_date <= @until`
      )
      .get({ today, until }) as { c: number }
    return Number(row.c)
  }

  /** 预警统计：已过期批次数 */
  function countExpired(): number {
    const today = todayDate()
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM product_batch WHERE expire_date IS NOT NULL AND expire_date < @today')
      .get({ today }) as { c: number }
    return Number(row.c)
  }

  return {
    setShelfLife,
    ensureBatch,
    listBatches,
    countExpiring,
    countExpired
  }
}

export type ShelfLifeService = ReturnType<typeof createShelfLifeService>
