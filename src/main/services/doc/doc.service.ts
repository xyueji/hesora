import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { DOC_NO_PREFIX } from '../../../shared/types/doc'
import type {
  DocCreateInput,
  DocItemRow,
  DocPageResult,
  DocQuery,
  DocRow
} from '../../../shared/types/doc'

export type DB = Database

interface DocDbRow {
  id: number
  no: string
  type: string
  date: string
  partner_id: number | null
  warehouse_id: number | null
  warehouse_in_id: number | null
  account_id: number | null
  source_doc_id: number | null
  reversal_of: number | null
  operator: string | null
  total_amount: number
  remark: string | null
  status: string
  created_at: string
  partner_name?: string | null
}

const PARTNER_JOIN = `
  LEFT JOIN customer c ON c.id = d.partner_id AND d.type IN ('sale','sale_return','retail','receipt')
  LEFT JOIN supplier s ON s.id = d.partner_id AND d.type IN ('purchase','purchase_return','payment')`

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`
}

function toDocRow(row: DocDbRow): DocRow {
  return {
    id: row.id,
    no: row.no,
    type: row.type as DocRow['type'],
    date: row.date,
    partner_id: row.partner_id,
    warehouse_id: row.warehouse_id,
    warehouse_in_id: row.warehouse_in_id,
    account_id: row.account_id,
    source_doc_id: row.source_doc_id,
    reversal_of: (row as { reversal_of?: number | null }).reversal_of ?? null,
    operator: (row as { operator?: string | null }).operator ?? null,
    // ── S 级功能批次 B ──
    external_no: (row as { external_no?: string | null }).external_no ?? null,
    invoice_status: ((row as { invoice_status?: string }).invoice_status ?? 'none') as DocRow['invoice_status'],
    express_com: (row as { express_com?: string | null }).express_com ?? null,
    express_no: (row as { express_no?: string | null }).express_no ?? null,
    delivery_status: ((row as { delivery_status?: string }).delivery_status ?? 'none') as DocRow['delivery_status'],
    reviewed_by: (row as { reviewed_by?: string | null }).reviewed_by ?? null,
    reviewed_at: (row as { reviewed_at?: string | null }).reviewed_at ?? null,
    // ── P2 #3 盘点复盘 ──
    review_by: (row as { review_by?: string | null }).review_by ?? null,
    review_at: (row as { review_at?: string | null }).review_at ?? null,
    review_remark: (row as { review_remark?: string | null }).review_remark ?? null,
    total_amount: row.total_amount,
    remark: row.remark,
    status: row.status as DocRow['status'],
    created_at: row.created_at,
    partner_name: row.partner_name ?? null
  }
}

export function createDocService(db: DB) {
  const insertDoc = db.prepare(`
    INSERT INTO doc (no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark, source_doc_id, operator, external_no, invoice_status, express_com, express_no, delivery_status)
    VALUES (@no, @type, @date, @partner_id, @warehouse_id, @warehouse_in_id, @account_id, @total_amount, @remark, @source_doc_id, @operator, @external_no, @invoice_status, @express_com, @express_no, @delivery_status)
  `)
  const insertItem = db.prepare(`
    INSERT INTO doc_item (doc_id, product_id, warehouse_id, batch_no, unit, rate, qty, price, amount)
    VALUES (@doc_id, @product_id, @warehouse_id, @batch_no, @unit, @rate, @qty, @price, @amount)
  `)

  // 读取可配置单号前缀（app_setting 键 doc.no_prefix，JSON {type: prefix}），缺省用内置值
  function readPrefix(type: string): string {
    const raw = db.prepare('SELECT value FROM app_setting WHERE key = ?').get('doc.no_prefix') as
      | { value: string }
      | undefined
    if (!raw?.value) return DOC_NO_PREFIX[type as keyof typeof DOC_NO_PREFIX]
    try {
      const map = JSON.parse(raw.value) as Record<string, string>
      const p = map[type]
      return typeof p === 'string' && p.trim() !== '' ? p.trim() : DOC_NO_PREFIX[type as keyof typeof DOC_NO_PREFIX]
    } catch {
      return DOC_NO_PREFIX[type as keyof typeof DOC_NO_PREFIX]
    }
  }

  // 生成单据编号：前缀 + yyyyMMdd + 4位流水。必须在插入事务内调用，避免并发重号。
  function nextDocNo(type: string, date: string): string {
    const compact = date.replace(/-/g, '')
    const prefix = `${readPrefix(type)}${compact}`
    const { last } = db
      .prepare('SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS last FROM doc WHERE type = ? AND date = ?')
      .get(prefix.length + 1, type, date) as { last: number | null }
    const seq = (last ?? 0) + 1
    return `${prefix}${pad(seq, 4)}`
  }

  function getById(id: number): DocRow | null {
    const row = db.prepare(`SELECT d.*, COALESCE(c.name, s.name) AS partner_name
      FROM doc d ${PARTNER_JOIN} WHERE d.id = ?`).get(id) as DocDbRow | undefined
    return row ? toDocRow(row) : null
  }

  function getItems(docId: number): DocItemRow[] {
    const rows = db.prepare(`
      SELECT i.*, (
        SELECT json_group_array(DISTINCT sn) FROM serial_flow WHERE doc_id = i.doc_id AND doc_item_id = i.id
      ) AS serial_json
      FROM doc_item i WHERE i.doc_id = ? ORDER BY i.id
    `).all(docId) as (DocItemRow & { serial_json: string })[]
    return rows.map(({ serial_json, ...row }) => {
      const serialNumbers = JSON.parse(serial_json) as string[]
      return serialNumbers.length ? { ...row, serial_numbers: serialNumbers } : row
    })
  }

  function assertReturnQuantity(input: DocCreateInput, lines: Array<{
    product_id: number
    batch_no: string
    qty: number
    rate: number
  }>): void {
    if (input.source_doc_id === undefined) return
    if (input.type !== 'purchase_return' && input.type !== 'sale_return') {
      throw new BizError('VALIDATION', '仅退货单可关联购销原单')
    }
    const sourceType = input.type === 'purchase_return' ? 'purchase' : 'sale'
    const source = getById(input.source_doc_id)
    if (!source || source.status !== 'done' || source.type !== sourceType) {
      throw new BizError('NOT_FOUND', '对应的已过账原单不存在')
    }
    if (source.partner_id !== (input.partner_id ?? null)) {
      throw new BizError('VALIDATION', '退货往来单位须与原单一致')
    }
    if (source.warehouse_id !== input.warehouse_id) {
      throw new BizError('VALIDATION', '退货仓库须与原单一致')
    }
    const available = db.prepare(`
      SELECT i.product_id, i.batch_no,
        SUM(CASE WHEN i.doc_id = @sourceId THEN i.qty * i.rate ELSE -i.qty * i.rate END) AS qty
      FROM doc_item i JOIN doc d ON d.id = i.doc_id
      WHERE d.id = @sourceId OR (d.source_doc_id = @sourceId AND d.type = @returnType AND d.status = 'done')
      GROUP BY i.product_id, i.batch_no
    `).all({ sourceId: source.id, returnType: input.type }) as Array<{
      product_id: number
      batch_no: string
      qty: number
    }>
    const lotKey = (line: { product_id: number; batch_no: string }): string =>
      JSON.stringify([Number(line.product_id), line.batch_no])
    const remaining = new Map(available.map((line) => [lotKey(line), line.qty]))
    for (const line of lines) {
      const key = lotKey(line)
      const qty = line.qty * line.rate
      const current = remaining.get(key) ?? 0
      const tolerance = 8 * Number.EPSILON * Math.max(qty, current)
      if (qty - current > tolerance) {
        throw new BizError('RETURN_LIMIT', `超过原单可退数量，商品 #${line.product_id} 可退 ${Math.max(0, current)} 基本单位`)
      }
      remaining.set(key, current - qty)
    }
  }

  function create(input: DocCreateInput): DocRow {
    const date = input.date ?? todayLocal()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BizError('VALIDATION', '单据日期格式应为 yyyy-MM-dd')
    }
    const needsItems = !['receipt', 'payment', 'other_in', 'other_out'].includes(input.type)
    if (needsItems && (!input.items || input.items.length === 0)) {
      throw new BizError('VALIDATION', '单据明细不能为空')
    }
    let docId = 0
    db.transaction(() => {
      const lines = input.items.map((it) => {
        if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
          throw new BizError('VALIDATION', '明细数量必须大于0')
        }
        const qty = Number(it.qty)
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const price = it.price === undefined || it.price === null ? 0 : Number(it.price)
        if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty * rate)) {
          throw new BizError('VALIDATION', '明细单位换算率无效')
        }
        const amount = qty * price
        if (price < 0 || !Number.isFinite(amount)) {
          throw new BizError('VALIDATION', '明细单价或金额无效')
        }
        return {
          product_id: it.product_id,
          warehouse_id: it.warehouse_id ?? null,
          batch_no: it.batch_no ?? '',
          unit: it.unit ?? '',
          rate,
          qty,
          price,
          amount
        }
      })
      const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0)
      assertReturnQuantity(input, lines)
      const no = nextDocNo(input.type, date)
      docId = Number(
        insertDoc.run({
          no,
          type: input.type,
          date,
          partner_id: input.partner_id ?? null,
          warehouse_id: input.warehouse_id ?? null,
          warehouse_in_id: input.warehouse_in_id ?? null,
          account_id: input.account_id ?? null,
          source_doc_id: input.source_doc_id ?? null,
          operator: input.operator?.trim() ? input.operator.trim() : null,
          // ── S 级功能批次 B：业务扩展字段 ──
          external_no: input.external_no?.trim() ? input.external_no.trim() : null,
          invoice_status: input.invoice_status ?? 'none',
          express_com: input.express_com?.trim() ? input.express_com.trim() : null,
          express_no: input.express_no?.trim() ? input.express_no.trim() : null,
          delivery_status: input.delivery_status ?? 'none',
          total_amount: totalAmount,
          remark: input.remark ?? null
        }).lastInsertRowid
      )
      for (const l of lines) insertItem.run({ doc_id: docId, ...l })
    }).immediate()
    return getById(docId) as DocRow
  }

  function query(q: DocQuery): DocPageResult {    const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
    const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (q.type) {
      where.push('d.type = @type')
      params['type'] = q.type
    } else if (q.types && q.types.length > 0) {
      where.push(`d.type IN (${q.types.map((_, i) => `@type_${i}`).join(',')})`)
      q.types.forEach((t, i) => {
        params[`type_${i}`] = t
      })
    }
    if (q.date_from) {
      where.push('d.date >= @date_from')
      params['date_from'] = q.date_from
    }
    if (q.date_to) {
      where.push('d.date <= @date_to')
      params['date_to'] = q.date_to
    }
    if (q.keyword) {
      where.push('d.no LIKE @kw')
      params['kw'] = `%${q.keyword}%`
    }
    if (q.partner_id !== undefined && q.partner_id !== null) {
      where.push('d.partner_id = @partner_id')
      params['partner_id'] = q.partner_id
    }
    const partnerKeyword = q.partner_keyword?.trim()
    if (partnerKeyword) {
      where.push('(INSTR(COALESCE(c.name, s.name), @partner_keyword) > 0 OR INSTR(COALESCE(c.code, s.code), @partner_keyword) > 0)')
      params['partner_keyword'] = partnerKeyword
    }
    // ── S 级功能批次 B：业务字段筛选 ──
    if (q.external_no?.trim()) {
      where.push('d.external_no = @external_no')
      params['external_no'] = q.external_no.trim()
    }
    if (q.invoice_status) {
      where.push('d.invoice_status = @invoice_status')
      params['invoice_status'] = q.invoice_status
    }
    if (q.delivery_status) {
      where.push('d.delivery_status = @delivery_status')
      params['delivery_status'] = q.delivery_status
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM doc d ${PARTNER_JOIN} ${whereSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(
        `SELECT d.*, COALESCE(c.name, s.name) AS partner_name
         FROM doc d ${PARTNER_JOIN}
         ${whereSql} ORDER BY d.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as DocDbRow[]
    return { total, items: rows.map(toDocRow) }
  }

  /** 通用单据详情：单据头 + 明细行（供单据查询中心使用）。 */
  function getDetailWithItems(id: number): { doc: DocRow; items: DocItemRow[] } | null {
    const doc = getById(id)
    if (!doc) return null
    return { doc, items: getItems(id) }
  }

  /** 直过账单据补审核：仅管理标记（不回滚账务），幂等（重复审核取最新）。 */
  function review(id: number, input: { reviewer: string }): DocRow {
    const reviewer = typeof input?.reviewer === 'string' ? input.reviewer.trim() : ''
    if (!reviewer) throw new BizError('VALIDATION', '审核人不能为空')
    const doc = db.prepare('SELECT id, status FROM doc WHERE id = ?').get(id) as
      | { id: number; status: string }
      | undefined
    if (!doc) throw new BizError('NOT_FOUND', `单据不存在：${id}`)
    if (doc.status !== 'done') {
      throw new BizError('VALIDATION', '仅已过账单据可补审核')
    }
    db.prepare(`UPDATE doc SET reviewed_by = ?, reviewed_at = ? WHERE id = ?`).run(
      reviewer,
      new Date().toISOString(),
      id
    )
    return getById(id) as DocRow
  }

  function remove(_id: number): void {
    throw new BizError('DOC_DONE', '已完成单据不可删除')
  }

  return { nextDocNo, create, getById, getItems, getDetailWithItems, query, review, remove }
}

export type DocService = ReturnType<typeof createDocService>
