import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { REPORT_COLUMNS, type ReportKind, type ReportPage, type ReportQuery, type ReportRow } from '../../../shared/types/report'
import { DOC_TYPE_LABELS, type DocType } from '../../../shared/types/doc'
import { buildCsv } from '../../../shared/csv'

const SALES = "('sale','retail','sale_return')"
const PURCHASES = "('purchase','purchase_return')"
const docPeriod = `d.status = 'done' AND d.date BETWEEN @date_from AND @date_to`
const docScope = `${docPeriod} AND (@warehouse_id IS NULL OR d.warehouse_id = @warehouse_id)`
const productSearch = `(@keyword = '' OR INSTR(p.code, @keyword) > 0 OR INSTR(p.name, @keyword) > 0)`
const sign = "CASE WHEN d.type IN ('sale_return','purchase_return') THEN -1 ELSE 1 END"

function dailyTotals(types: string): string {
  return `SELECT d.date, COUNT(*) AS count,
    SUM(CASE WHEN (${sign}) = 1 THEN d.total_amount ELSE 0 END) AS gross,
    SUM(CASE WHEN (${sign}) = -1 THEN d.total_amount ELSE 0 END) AS returns,
    SUM((${sign}) * d.total_amount) AS amount
    FROM doc d WHERE ${docScope} AND d.type IN ${types} GROUP BY d.date`
}

const reports: Record<ReportKind, { sql: string; order: string }> = {
  sales: { sql: dailyTotals(SALES), order: 'date DESC' },
  purchases: { sql: dailyTotals(PURCHASES), order: 'date DESC' },
  profit: {
    sql: `WITH costs AS (
      SELECT d.date, (${sign}) * d.total_amount AS revenue,
        (SELECT SUM(-c.change_qty * c.unit_cost) FROM cost_log c
          WHERE c.source = d.type AND c.source_id = d.id) AS cost
      FROM doc d WHERE ${docScope} AND d.type IN ${SALES}
    ) SELECT date, SUM(revenue) AS revenue,
      CASE WHEN COUNT(cost) = COUNT(*) THEN SUM(cost) END AS cost,
      CASE WHEN COUNT(cost) = COUNT(*) THEN SUM(revenue - cost) END AS profit
      FROM costs GROUP BY date`,
    order: 'date DESC'
  },
  fund: {
    sql: `SELECT f.id, f.date, COALESCE(d.no, t.no) AS no, f.doc_type AS type, a.name AS account,
      CASE WHEN f.direction = 'in' THEN f.amount ELSE 0 END AS income,
      CASE WHEN f.direction = 'out' THEN f.amount ELSE 0 END AS expense, f.remark
      FROM fund_flow f LEFT JOIN fund_account a ON a.id = f.account_id
      LEFT JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
      LEFT JOIN fund_transfer t ON t.id = f.doc_id AND f.doc_type = 'account_transfer'
      WHERE f.date BETWEEN @date_from AND @date_to AND (d.id IS NULL OR d.status = 'done')
        AND (@account_id IS NULL OR f.account_id = @account_id)
        AND (@direction IS NULL OR f.direction = @direction)
        AND (@keyword = '' OR INSTR(COALESCE(d.no, t.no), @keyword) > 0 OR INSTR(f.remark, @keyword) > 0)
        AND (f.doc_type NOT IN ('sale_return','purchase_return') OR d.account_id = f.account_id)`,
    order: 'date DESC, id DESC'
  },
  hot: {
    sql: `SELECT p.id, p.code, p.name, p.base_unit AS unit,
      SUM((${sign}) * i.qty * i.rate) AS qty, SUM((${sign}) * i.amount) AS amount
      FROM doc d JOIN doc_item i ON i.doc_id = d.id JOIN product p ON p.id = i.product_id
      WHERE ${docScope} AND d.type IN ${SALES} AND ${productSearch} GROUP BY p.id HAVING qty > 0`,
    order: 'qty DESC, id ASC'
  },
  stockSheet: {
    sql: `SELECT i.id, p.code, p.name, p.base_unit AS unit, w.name AS warehouse, i.batch_no, i.qty AS book_qty
      FROM inventory i JOIN product p ON p.id = i.product_id JOIN warehouse w ON w.id = i.warehouse_id
      WHERE i.qty <> 0 AND (@warehouse_id IS NULL OR i.warehouse_id = @warehouse_id) AND ${productSearch}`,
    order: 'warehouse, code, batch_no, id'
  },
  stocktake: {
    sql: `SELECT c.id, d.date, d.no, p.code, p.name, p.base_unit AS unit, w.name AS warehouse, c.batch_no,
      c.after_qty - c.change_qty AS book_qty, c.after_qty AS actual_qty, c.change_qty AS diff
      FROM doc d JOIN cost_log c ON c.source_id = d.id AND c.source = d.type
      JOIN product p ON p.id = c.product_id JOIN warehouse w ON w.id = c.warehouse_id
      WHERE ${docScope} AND d.type = 'stocktake' AND ${productSearch}`,
    order: 'date DESC, id DESC'
  }
}

export function createReportService(db: Database) {
  function scope(input: ReportQuery) {
    if (!input || !Object.hasOwn(reports, input.kind)) {
      throw new BizError('VALIDATION', '请选择报表类型')
    }
    const dateFrom = input.date_from || '0001-01-01'
    const dateTo = input.date_to || '9999-12-31'
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!datePattern.test(dateFrom) || !datePattern.test(dateTo) || dateFrom > dateTo) {
      throw new BizError('VALIDATION', '请选择有效的日期范围')
    }
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      warehouse_id: input.warehouse_id ?? null,
      account_id: input.account_id ?? null,
      direction: input.direction ?? null,
      keyword: input.keyword?.trim() ?? ''
    }
    return { ...reports[input.kind], params }
  }

  function query(input: ReportQuery): ReportPage {
    const { sql, order, params } = scope(input)
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(input.pageSize) || 50)))
    const page = Math.max(1, Math.trunc(Number(input.page) || 1))
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM (${sql})`).get(params) as { total: number }
    const rows = db.prepare(`SELECT * FROM (${sql}) ORDER BY ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset: (page - 1) * limit }) as ReportRow[]
    if (input.kind === 'fund') {
      const totals = db.prepare(`SELECT COALESCE(SUM(income), 0) AS income, COALESCE(SUM(expense), 0) AS expense FROM (${sql}) WHERE type <> 'account_transfer'`)
        .get(params) as { income: number; expense: number }
      return { rows, total, totals }
    }
    return { rows, total }
  }

  function exportCsv(input: ReportQuery): string {
    const { sql, order, params } = scope(input)
    const columns = REPORT_COLUMNS[input.kind]
    const rows = db.prepare(`SELECT * FROM (${sql}) ORDER BY ${order}`).all(params) as ReportRow[]
    return buildCsv(columns.map(([, label]) => label), rows.map((row) => columns.map(([key]) => {
      const value = row[key]
      return key === 'type' && typeof value === 'string' ? DOC_TYPE_LABELS[value as DocType] ?? value : value ?? null
    })))
  }

  /**
   * 员工业绩：按 doc.operator GROUP BY 的销售类业绩（旧数据无业务员 → operator 为 null 分组）。
   * 销售额 = sale+retail 金额；退货额 = sale_return 金额；
   * 毛利近似 = sale 类明细 amount − qty*rate*当前 moving_cost（与现有 profit 口径一致的简化版，
   * 区别在于以当前 inventory.moving_cost 估算而非 cost_log 逐笔回溯）。
   */
  function operatorPerformance(query: { date_from?: string; date_to?: string; operator?: string }) {
    const dateFrom = query?.date_from || '0001-01-01'
    const dateTo = query?.date_to || '9999-12-31'
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!datePattern.test(dateFrom) || !datePattern.test(dateTo) || dateFrom > dateTo) {
      throw new BizError('VALIDATION', '请选择有效的日期范围')
    }
    const keyword = query?.operator?.trim() ?? ''
    const sql = `SELECT d.operator,
        COALESCE(SUM(CASE WHEN d.type IN ('sale','retail') THEN i.amount END), 0) AS sales_amount,
        COALESCE(SUM(CASE WHEN d.type = 'sale_return' THEN i.amount END), 0) AS return_amount,
        COUNT(DISTINCT d.id) AS doc_count,
        COALESCE(SUM(CASE WHEN d.type IN ('sale','retail','sale_return') THEN (${sign}) * (i.amount - i.qty * i.rate * COALESCE(inv.moving_cost, 0)) END), 0) AS gross_profit
      FROM doc d
      JOIN doc_item i ON i.doc_id = d.id
      LEFT JOIN inventory inv ON inv.product_id = i.product_id AND inv.warehouse_id = COALESCE(i.warehouse_id, d.warehouse_id)
      WHERE d.status = 'done' AND d.date BETWEEN @date_from AND @date_to
        AND d.type IN ('sale','retail','sale_return')
        AND (@keyword = '' OR INSTR(COALESCE(d.operator, ''), @keyword) > 0)
      GROUP BY d.operator
      ORDER BY sales_amount DESC, doc_count DESC`
    return db.prepare(sql).all({ date_from: dateFrom, date_to: dateTo, keyword }) as Array<{
      operator: string | null
      sales_amount: number
      return_amount: number
      doc_count: number
      gross_profit: number
    }>
  }

  /** [10] 科目资金汇总：income_category 科目 × 收入/支出合计（S 级功能批次 B）
   *  口径：fund_flow.category_id 关联科目（migration 040）；
   *  - 仅统计已审核单据（与 fund 报表口径一致：LEFT JOIN doc 校验 status）；
   *  - category_id 为 NULL 的流水归入"未分类"；
   *  - income/expense 取自 fund_flow.direction，不区分单据方向符号。
   */
  function fundSummaryByCategory(query: { date_from?: string; date_to?: string }) {
    const dateFrom = query?.date_from || '0001-01-01'
    const dateTo = query?.date_to || '9999-12-31'
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!datePattern.test(dateFrom) || !datePattern.test(dateTo) || dateFrom > dateTo) {
      throw new BizError('VALIDATION', '请选择有效的日期范围')
    }
    return db
      .prepare(
        `SELECT COALESCE(cat.id, 0) AS category_id,
                COALESCE(cat.name, '未分类') AS category_name,
                cat.kind AS category_kind,
                COALESCE(SUM(CASE WHEN f.direction = 'in' THEN f.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN f.direction = 'out' THEN f.amount ELSE 0 END), 0) AS expense,
                COALESCE(SUM(CASE WHEN f.direction = 'in' THEN f.amount ELSE -f.amount END), 0) AS net
         FROM fund_flow f
         LEFT JOIN income_category cat ON cat.id = f.category_id
         LEFT JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
         WHERE f.date BETWEEN @date_from AND @date_to
           AND (d.id IS NULL OR d.status = 'done')
         GROUP BY cat.id, cat.name, cat.kind
         ORDER BY income + expense DESC`
      )
      .all({ date_from: dateFrom, date_to: dateTo }) as Array<{
      category_id: number
      category_name: string
      category_kind: string | null
      income: number
      expense: number
      net: number
    }>
  }

  /**
   * P3：销售日历——按日聚合销售额（口径 sale+retail，status='done'）。
   * 返回该月每日 {date, count, amount}，仅含有单据的日期。
   */
  function calendarSales(query: { year: number; month: number }): Array<{
    date: string
    count: number
    amount: number
  }> {
    const year = Math.trunc(Number(query?.year))
    const month = Math.trunc(Number(query?.month))
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new BizError('VALIDATION', '请选择有效的年月')
    }
    const mm = String(month).padStart(2, '0')
    return db
      .prepare(
        `SELECT d.date, COUNT(*) AS count, COALESCE(SUM(d.total_amount), 0) AS amount
         FROM doc d
         WHERE d.status = 'done' AND d.type IN ('sale','retail') AND d.date LIKE @pattern
         GROUP BY d.date ORDER BY d.date`
      )
      .all({ pattern: `${year}-${mm}-%` }) as Array<{ date: string; count: number; amount: number }>
  }

  /**
   * S 级：热销商品榜——按销售数量排序的商品榜。
   * 口径说明（对冲选择）：doc type IN ('sale','retail') 且 status='done'，doc_item 汇总；
   * 仅统计正向销售单，销售退货单（sale_return）**不冲减**——与参考系统 /report/hot-sale 的
   * 正向口径一致（榜单反映"卖出了多少"，退货量另见 sales 报表的 returns 列）。
   * 返回 [{product_id, code, name, sale_qty, sale_amount}]，按 sale_qty 降序取前 top 条。
   */
  function hotSale(query: {
    date_from?: string
    date_to?: string
    top?: number
    warehouse_id?: number
  }): Array<{ product_id: number; code: string; name: string; sale_qty: number; sale_amount: number }> {
    const dateFrom = query?.date_from || '0001-01-01'
    const dateTo = query?.date_to || '9999-12-31'
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!datePattern.test(dateFrom) || !datePattern.test(dateTo) || dateFrom > dateTo) {
      throw new BizError('VALIDATION', '请选择有效的日期范围')
    }
    const top = Math.min(200, Math.max(1, Math.trunc(Number(query?.top) || 20)))
    const warehouseId = query?.warehouse_id ?? null
    return db
      .prepare(
        `SELECT i.product_id, p.code, p.name,
           SUM(i.qty * i.rate) AS sale_qty,
           SUM(i.amount) AS sale_amount
         FROM doc d
         JOIN doc_item i ON i.doc_id = d.id
         JOIN product p ON p.id = i.product_id
         WHERE d.status = 'done' AND d.type IN ('sale','retail')
           AND d.date BETWEEN @date_from AND @date_to
           AND (@warehouse_id IS NULL OR d.warehouse_id = @warehouse_id)
         GROUP BY i.product_id, p.code, p.name
         ORDER BY sale_qty DESC, p.code ASC
         LIMIT @top`
      )
      .all({ date_from: dateFrom, date_to: dateTo, top, warehouse_id: warehouseId }) as Array<{
      product_id: number
      code: string
      name: string
      sale_qty: number
      sale_amount: number
    }>
  }

  return { query, exportCsv, operatorPerformance, fundSummaryByCategory, calendarSales, hotSale }
}
