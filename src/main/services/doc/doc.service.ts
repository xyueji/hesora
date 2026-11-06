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
  total_amount: number
  remark: string | null
  status: string
  created_at: string
}

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
    total_amount: row.total_amount,
    remark: row.remark,
    status: row.status as DocRow['status'],
    created_at: row.created_at
  }
}

export function createDocService(db: DB) {
  const insertDoc = db.prepare(`
    INSERT INTO doc (no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark)
    VALUES (@no, @type, @date, @partner_id, @warehouse_id, @warehouse_in_id, @account_id, @total_amount, @remark)
  `)
  const insertItem = db.prepare(`
    INSERT INTO doc_item (doc_id, product_id, warehouse_id, batch_no, unit, rate, qty, price, amount)
    VALUES (@doc_id, @product_id, @warehouse_id, @batch_no, @unit, @rate, @qty, @price, @amount)
  `)

  // 生成单据编号：前缀 + yyyyMMdd + 4位流水。必须在插入事务内调用，避免并发重号。
  function nextDocNo(type: string, date: string): string {
    const compact = date.replace(/-/g, '')
    const prefix = `${DOC_NO_PREFIX[type as keyof typeof DOC_NO_PREFIX]}${compact}`
    const last = db
      .prepare("SELECT no FROM doc WHERE no LIKE ? ORDER BY no DESC LIMIT 1")
      .get(`${prefix}%`) as { no: string } | undefined
    const seq = last ? Number(last.no.slice(prefix.length)) + 1 : 1
    return `${prefix}${pad(seq, 4)}`
  }

  function getById(id: number): DocRow | null {
    const row = db.prepare('SELECT * FROM doc WHERE id = ?').get(id) as DocDbRow | undefined
    return row ? toDocRow(row) : null
  }

  function getItems(docId: number): DocItemRow[] {
    return db
      .prepare('SELECT * FROM doc_item WHERE doc_id = ? ORDER BY id')
      .all(docId) as DocItemRow[]
  }

  function create(input: DocCreateInput): DocRow {
    const date = input.date ?? todayLocal()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BizError('VALIDATION', '单据日期格式应为 yyyy-MM-dd')
    }
    if (!input.items || input.items.length === 0) {
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
        const amount = qty * price * rate
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
          total_amount: totalAmount,
          remark: input.remark ?? null
        }).lastInsertRowid
      )
      for (const l of lines) insertItem.run({ doc_id: docId, ...l })
    })()
    return getById(docId) as DocRow
  }

  function query(q: DocQuery): DocPageResult {
    const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
    const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (q.type) {
      where.push('type = @type')
      params['type'] = q.type
    }
    if (q.date_from) {
      where.push('date >= @date_from')
      params['date_from'] = q.date_from
    }
    if (q.date_to) {
      where.push('date <= @date_to')
      params['date_to'] = q.date_to
    }
    if (q.keyword) {
      where.push('no LIKE @kw')
      params['kw'] = `%${q.keyword}%`
    }
    if (q.partner_id !== undefined && q.partner_id !== null) {
      where.push('partner_id = @partner_id')
      params['partner_id'] = q.partner_id
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM doc ${whereSql}`).get(params) as { c: number }).c
    )
    const rows = db
      .prepare(`SELECT * FROM doc ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as DocDbRow[]
    return { total, items: rows.map(toDocRow) }
  }

  function remove(_id: number): void {
    throw new BizError('DOC_DONE', '已完成单据不可删除')
  }

  return { nextDocNo, create, getById, getItems, query, remove }
}

export type DocService = ReturnType<typeof createDocService>
