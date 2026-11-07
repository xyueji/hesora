import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { COST_SOURCE_LABELS } from '../../../shared/types/stock-report'
import type {
  AdjustPriceItem,
  AdjustPriceResult,
  CostChangePage,
  CostChangeQuery,
  CostChangeRow,
  PriceAdjustLogRow,
  PriceType,
  SetWarningsByConditionInput,
  SetWarningsResult,
  StatsDetailPage,
  StatsDetailQuery,
  StatsDetailRow,
  StockFlowQuery,
  StockFlowResult,
  StockFlowRow,
  WarningPage,
  WarningQuery,
  WarningRow
} from '../../../shared/types/stock-report'

export type DB = Database

/** 非单据类库存变动的来源中文名（单据类来源见 DOC_TYPE_LABELS） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface RawCostRow {
  id: number
  created_at: string
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  source: string
  source_no: string
  change_qty: number
  unit_cost: number
  after_qty: number
  after_cost: number
}

interface RawFlowRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  warehouse_id: number
  warehouse_name: string
  open_qty: number
  open_amount: number
  in_qty: number
  in_amount: number
  out_qty: number
  out_amount: number
}

interface RawWarningRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  qty: number
  min_stock: number
}

/** 变动来源中文名（单据类来源见 DOC_TYPE_LABELS，其余见 COST_SOURCE_LABELS） */
function sourceLabel(source: string): string {
  return COST_SOURCE_LABELS[source] ?? source ?? '其他'
}

/** 分页参数归一：page >= 1，pageSize 限制在 1..200 */
function paging(query: { page?: number; pageSize?: number }): {
  page: number
  pageSize: number
} {
  const page = Math.max(Math.trunc(Number(query.page) || 1), 1)
  const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize) || 20), 1), 200)
  return { page, pageSize }
}

/** 日期入参归一：必须是 YYYY-MM-DD，空值表示不限 */
function normalizeDay(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const v = String(value).trim()
  if (v === '') return undefined
  if (!DATE_RE.test(v)) throw new BizError('VALIDATION', `${label}格式应为 YYYY-MM-DD`)
  return v
}

/** 起始边界（含），无上限时用一个极早的时间戳 */
function dayStart(value: string | undefined): string {
  return value ? `${value} 00:00:00` : '0001-01-01 00:00:00'
}

/** 结束边界（不含），即截止日期的次日零点 */
function dayEndExclusive(value: string | undefined): string {
  if (!value) return '9999-12-31 23:59:59'
  const d = new Date(`${value}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day} 00:00:00`
}

function priceColumn(type: PriceType): 'retail_price' | 'trade_price' | 'purchase_price' {
  if (type === 'retail') return 'retail_price'
  if (type === 'trade') return 'trade_price'
  return 'purchase_price'
}

export function createStockReportService(db: DB) {
  /* ------------------------------ 库存统计明细 ------------------------------ */

  function statisticsDetail(query: StatsDetailQuery): StatsDetailPage {
    const { page, pageSize } = paging(query ?? { page: 1, pageSize: 20 })
    const where: string[] = ['i.qty <> 0']
    const params: Record<string, unknown> = {}
    if (query.keyword) {
      where.push('(p.code LIKE @kw OR p.name LIKE @kw)')
      params['kw'] = `%${query.keyword}%`
    }
    if (query.product_id !== undefined) {
      where.push('i.product_id = @product_id')
      params['product_id'] = query.product_id
    }
    if (query.warehouse_id !== undefined) {
      where.push('i.warehouse_id = @warehouse_id')
      params['warehouse_id'] = query.warehouse_id
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const fromSql = `
      FROM inventory i
      JOIN product p ON p.id = i.product_id
      JOIN warehouse w ON w.id = i.warehouse_id
      ${whereSql}
    `
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS c ${fromSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(
        `SELECT
           i.product_id,
           p.code,
           p.name,
           COALESCE(p.spec, '') AS spec,
           p.base_unit,
           i.warehouse_id,
           w.name AS warehouse_name,
           i.batch_no,
           i.qty,
           i.moving_cost,
           i.qty * i.moving_cost AS amount
         ${fromSql}
         ORDER BY p.code, i.warehouse_id, i.batch_no, i.id
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as StatsDetailRow[]
    const sums = db
      .prepare(
        `SELECT
           COALESCE(SUM(i.qty), 0) AS qty,
           COALESCE(SUM(i.qty * i.moving_cost), 0) AS amount
         ${fromSql}`
      )
      .get(params) as { qty: number; amount: number }
    return {
      total,
      items: rows,
      totals: { qty: sums.qty, amount: sums.amount }
    }
  }

  /* ------------------------------ 成本变动明细 ------------------------------ */

  function costChanges(query: CostChangeQuery): CostChangePage {
    const { page, pageSize } = paging(query ?? { page: 1, pageSize: 20 })
    const from = normalizeDay(query.date_from, '起始日期')
    const to = normalizeDay(query.date_to, '截止日期')
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (query.keyword) {
      where.push('(p.code LIKE @kw OR p.name LIKE @kw OR d.no LIKE @kw)')
      params['kw'] = `%${query.keyword}%`
    }
    if (query.product_id !== undefined) {
      where.push('c.product_id = @product_id')
      params['product_id'] = query.product_id
    }
    if (query.warehouse_id !== undefined) {
      where.push('c.warehouse_id = @warehouse_id')
      params['warehouse_id'] = query.warehouse_id
    }
    if (query.source) {
      where.push('c.source = @source')
      params['source'] = query.source
    }
    if (from) {
      where.push('c.created_at >= @from')
      params['from'] = dayStart(from)
    }
    if (to) {
      where.push('c.created_at < @to')
      params['to'] = dayEndExclusive(to)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const fromSql = `
      FROM cost_log c
      JOIN product p ON p.id = c.product_id
      JOIN warehouse w ON w.id = c.warehouse_id
      LEFT JOIN doc d ON d.id = c.source_id AND d.type = c.source
      ${whereSql}
    `
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS c ${fromSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(
        `SELECT
           c.id,
           c.created_at,
           c.product_id,
           p.code,
           p.name,
           COALESCE(p.spec, '') AS spec,
           p.base_unit,
           c.warehouse_id,
           w.name AS warehouse_name,
           c.batch_no,
           c.source,
           COALESCE(d.no, '') AS source_no,
           c.change_qty,
           c.unit_cost,
           c.after_qty,
           c.after_cost
         ${fromSql}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as RawCostRow[]
    const sums = db
      .prepare(
        `SELECT
           COUNT(*) AS count,
           COALESCE(SUM(c.change_qty), 0) AS change_qty,
           COALESCE(SUM(c.change_qty * c.unit_cost), 0) AS change_amount
         ${fromSql}`
      )
      .get(params) as { count: number; change_qty: number; change_amount: number }

    const items: CostChangeRow[] = rows.map((r) => {
      const changeAmount = r.change_qty * r.unit_cost
      const afterAmount = r.after_qty * r.after_cost
      return {
        id: r.id,
        created_at: r.created_at,
        product_id: r.product_id,
        code: r.code,
        name: r.name,
        spec: r.spec,
        base_unit: r.base_unit,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name,
        batch_no: r.batch_no,
        source: r.source,
        source_label: sourceLabel(r.source),
        source_no: r.source_no,
        change_qty: r.change_qty,
        unit_cost: r.unit_cost,
        change_amount: changeAmount,
        before_qty: r.after_qty - r.change_qty,
        before_amount: afterAmount - changeAmount,
        after_qty: r.after_qty,
        after_amount: afterAmount,
        after_cost: r.after_cost
      }
    })

    return {
      total,
      items,
      totals: {
        change_qty: sums.change_qty,
        change_amount: sums.change_amount,
        count: sums.count
      }
    }
  }

  /* ------------------------------ 库存流水（收发存） ------------------------------ */

  function stockFlow(query: StockFlowQuery): StockFlowResult {
    const from = normalizeDay(query.date_from, '起始日期')
    const to = normalizeDay(query.date_to, '截止日期')
    const where: string[] = []
    const params: Record<string, unknown> = {
      from: dayStart(from),
      to: dayEndExclusive(to)
    }
    if (query.keyword) {
      where.push('(p.code LIKE @kw OR p.name LIKE @kw)')
      params['kw'] = `%${query.keyword}%`
    }
    if (query.product_id !== undefined) {
      where.push('k.product_id = @product_id')
      params['product_id'] = query.product_id
    }
    if (query.warehouse_id !== undefined) {
      where.push('k.warehouse_id = @warehouse_id')
      params['warehouse_id'] = query.warehouse_id
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    // 期初结存 = 期初日期之前每个「商品+仓库+批次」最后一条流水结转的数量与金额
    const rows = db
      .prepare(
        `WITH open_last AS (
           SELECT c.product_id, c.warehouse_id, c.batch_no, c.after_qty, c.after_cost
           FROM cost_log c
           JOIN (
             SELECT product_id, warehouse_id, batch_no, MAX(id) AS max_id
             FROM cost_log
             WHERE created_at < @from
             GROUP BY product_id, warehouse_id, batch_no
           ) m ON m.max_id = c.id
         ),
         opening AS (
           SELECT product_id, warehouse_id,
             SUM(after_qty) AS open_qty,
             SUM(after_qty * after_cost) AS open_amount
           FROM open_last
           GROUP BY product_id, warehouse_id
         ),
         moves AS (
           SELECT product_id, warehouse_id,
             SUM(CASE WHEN change_qty > 0 THEN change_qty ELSE 0 END) AS in_qty,
             SUM(CASE WHEN change_qty < 0 THEN -change_qty ELSE 0 END) AS out_qty,
             SUM(CASE WHEN change_qty > 0 THEN change_qty * unit_cost ELSE 0 END) AS in_amount,
             SUM(CASE WHEN change_qty < 0 THEN -change_qty * unit_cost ELSE 0 END) AS out_amount
           FROM cost_log
           WHERE created_at >= @from AND created_at < @to
           GROUP BY product_id, warehouse_id
         ),
         keys AS (
           SELECT product_id, warehouse_id FROM opening
           UNION
           SELECT product_id, warehouse_id FROM moves
         )
         SELECT
           k.product_id,
           p.code,
           p.name,
           COALESCE(p.spec, '') AS spec,
           p.base_unit,
           k.warehouse_id,
           w.name AS warehouse_name,
           COALESCE(op.open_qty, 0) AS open_qty,
           COALESCE(op.open_amount, 0) AS open_amount,
           COALESCE(mv.in_qty, 0) AS in_qty,
           COALESCE(mv.in_amount, 0) AS in_amount,
           COALESCE(mv.out_qty, 0) AS out_qty,
           COALESCE(mv.out_amount, 0) AS out_amount
         FROM keys k
         JOIN product p ON p.id = k.product_id
         JOIN warehouse w ON w.id = k.warehouse_id
         LEFT JOIN opening op
           ON op.product_id = k.product_id AND op.warehouse_id = k.warehouse_id
         LEFT JOIN moves mv
           ON mv.product_id = k.product_id AND mv.warehouse_id = k.warehouse_id
         ${whereSql}
         ORDER BY p.code, k.warehouse_id`
      )
      .all(params) as RawFlowRow[]

    const items: StockFlowRow[] = rows.map((r) => ({
      product_id: r.product_id,
      code: r.code,
      name: r.name,
      spec: r.spec,
      base_unit: r.base_unit,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name,
      open_qty: r.open_qty,
      in_qty: r.in_qty,
      out_qty: r.out_qty,
      close_qty: r.open_qty + r.in_qty - r.out_qty,
      open_amount: r.open_amount,
      in_amount: r.in_amount,
      out_amount: r.out_amount,
      close_amount: r.open_amount + r.in_amount - r.out_amount
    }))

    const totals = items.reduce(
      (acc, r) => ({
        open_qty: acc.open_qty + r.open_qty,
        in_qty: acc.in_qty + r.in_qty,
        out_qty: acc.out_qty + r.out_qty,
        close_qty: acc.close_qty + r.close_qty,
        open_amount: acc.open_amount + r.open_amount,
        in_amount: acc.in_amount + r.in_amount,
        out_amount: acc.out_amount + r.out_amount,
        close_amount: acc.close_amount + r.close_amount
      }),
      {
        open_qty: 0,
        in_qty: 0,
        out_qty: 0,
        close_qty: 0,
        open_amount: 0,
        in_amount: 0,
        out_amount: 0,
        close_amount: 0
      }
    )

    return { items, totals }
  }

  /* ------------------------------ 库存预警 ------------------------------ */

  function warnings(query: WarningQuery): WarningPage {
    const { page, pageSize } = paging(query ?? { page: 1, pageSize: 20 })
    const where: string[] = ['p.disabled = 0']
    const params: Record<string, unknown> = {}
    if (query.keyword) {
      where.push('(p.code LIKE @kw OR p.name LIKE @kw)')
      params['kw'] = `%${query.keyword}%`
    }
    const stockSql = `
      SELECT product_id, SUM(qty) AS qty
      FROM inventory
      ${query.warehouse_id !== undefined ? 'WHERE warehouse_id = @warehouse_id' : ''}
      GROUP BY product_id
    `
    if (query.warehouse_id !== undefined) params['warehouse_id'] = query.warehouse_id
    const baseSql = `
      FROM product p
      LEFT JOIN (${stockSql}) s ON s.product_id = p.id
      WHERE ${where.join(' AND ')}
        AND COALESCE(s.qty, 0) <= COALESCE(p.min_stock, 0)
        AND (p.min_stock IS NOT NULL OR s.qty IS NOT NULL)
    `
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS c ${baseSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(
        `SELECT
           p.id AS product_id,
           p.code,
           p.name,
           COALESCE(p.spec, '') AS spec,
           p.base_unit,
           COALESCE(s.qty, 0) AS qty,
           COALESCE(p.min_stock, 0) AS min_stock
         ${baseSql}
         ORDER BY p.code
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as RawWarningRow[]
    const sums = db
      .prepare(
        `SELECT
           COUNT(*) AS count,
           COALESCE(SUM(COALESCE(s.qty, 0)), 0) AS qty,
           COALESCE(SUM(COALESCE(p.min_stock, 0) - COALESCE(s.qty, 0)), 0) AS diff
         ${baseSql}`
      )
      .get(params) as { count: number; qty: number; diff: number }

    const items: WarningRow[] = rows.map((r) => ({
      product_id: r.product_id,
      code: r.code,
      name: r.name,
      spec: r.spec,
      base_unit: r.base_unit,
      qty: r.qty,
      min_stock: r.min_stock,
      diff: r.min_stock - r.qty,
      status: r.qty <= 0 ? '缺货' : '低于预警值'
    }))

    return {
      total,
      items,
      totals: { count: sums.count, qty: sums.qty, diff: sums.diff }
    }
  }

  /** 设置单个商品的库存预警值 */
  function setWarning(productId: number, minStock: number): void {
    const pid = Number(productId)
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new BizError('VALIDATION', '请选择要设置预警值的商品')
    }
    const min = Number(minStock)
    if (!Number.isFinite(min) || min < 0) {
      throw new BizError('VALIDATION', '预警值不能为负数')
    }
    const row = db.prepare('SELECT id FROM product WHERE id = ?').get(pid)
    if (!row) throw new BizError('NOT_FOUND', `商品不存在：${pid}`)
    db.prepare(
      "UPDATE product SET min_stock = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(min, pid)
  }

  /** 按条件批量设置库存预警值 */
  function setWarningsByCondition(
    condition: SetWarningsByConditionInput,
    minStock: number
  ): SetWarningsResult {
    const min = Number(minStock)
    if (!Number.isFinite(min) || min < 0) {
      throw new BizError('VALIDATION', '预警值不能为负数')
    }
    const where: string[] = ['disabled = 0']
    const params: Record<string, unknown> = { min_stock: min }
    if (condition?.keyword) {
      where.push('(code LIKE @kw OR name LIKE @kw)')
      params['kw'] = `%${condition.keyword}%`
    }
    if (condition?.min_stock !== undefined) {
      const current = Number(condition.min_stock)
      if (!Number.isFinite(current) || current < 0) {
        throw new BizError('VALIDATION', '筛选用的预警值不能为负数')
      }
      where.push('COALESCE(min_stock, 0) = @current')
      params['current'] = current
    }
    const r = db
      .prepare(
        `UPDATE product
         SET min_stock = @min_stock, updated_at = datetime('now','localtime')
         WHERE ${where.join(' AND ')}`
      )
      .run(params)
    return { updated: r.changes }
  }

  /* ------------------------------ 调整售价 ------------------------------ */

  function adjustPrices(items: AdjustPriceItem[], operator?: string): AdjustPriceResult {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BizError('VALIDATION', '请至少选择一个商品再调整价格')
    }
    const op = operator && operator.trim() !== '' ? operator.trim() : null
    const logs: PriceAdjustLogRow[] = []
    const touched = new Set<number>()

    db.transaction(() => {
      for (const item of items) {
        const pid = Number(item?.product_id)
        if (!Number.isInteger(pid) || pid <= 0) {
          throw new BizError('VALIDATION', '商品不能为空')
        }
        const row = db
          .prepare(
            'SELECT id, retail_price, trade_price, purchase_price FROM product WHERE id = ?'
          )
          .get(pid) as
          | { id: number; retail_price: number; trade_price: number; purchase_price: number }
          | undefined
        if (!row) throw new BizError('NOT_FOUND', `商品不存在：${pid}`)

        const changes: Array<{ type: PriceType; value: number }> = []
        if (item.retail_price !== undefined) changes.push({ type: 'retail', value: item.retail_price })
        if (item.trade_price !== undefined) changes.push({ type: 'trade', value: item.trade_price })
        if (item.purchase_price !== undefined) {
          changes.push({ type: 'purchase', value: item.purchase_price })
        }
        if (changes.length === 0) {
          throw new BizError('VALIDATION', '请至少填写一种价格')
        }

        for (const ch of changes) {
          const value = Number(ch.value)
          if (!Number.isFinite(value) || value < 0) {
            throw new BizError('VALIDATION', '价格不能为负数')
          }
          const oldPrice = Number(row[priceColumn(ch.type)])
          const info = db
            .prepare(
              `INSERT INTO price_adjust_log (product_id, price_type, old_price, new_price, operator)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(pid, ch.type, oldPrice, value, op)
          db.prepare(
            `UPDATE product SET ${priceColumn(ch.type)} = ?, updated_at = datetime('now','localtime') WHERE id = ?`
          ).run(value, pid)
          const inserted = db
            .prepare(
              `SELECT id, product_id, price_type, old_price, new_price, operator, created_at
               FROM price_adjust_log WHERE id = ?`
            )
            .get(Number(info.lastInsertRowid)) as {
            id: number
            product_id: number
            price_type: string
            old_price: number
            new_price: number
            operator: string | null
            created_at: string
          }
          logs.push({
            id: inserted.id,
            product_id: inserted.product_id,
            price_type: inserted.price_type as PriceType,
            old_price: inserted.old_price,
            new_price: inserted.new_price,
            operator: inserted.operator,
            created_at: inserted.created_at
          })
          touched.add(pid)
        }
      }
    })()

    return { updated: logs.length, products: touched.size, logs }
  }

  return {
    statisticsDetail,
    costChanges,
    stockFlow,
    warnings,
    setWarning,
    setWarningsByCondition,
    adjustPrices
  }
}

export type StockReportService = ReturnType<typeof createStockReportService>
