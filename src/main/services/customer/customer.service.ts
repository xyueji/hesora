import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PageResult } from '../../../shared/types/common'
import type { Customer, CustomerQuery } from '../../../shared/types/customer'

export type DB = Database

/** [4][8] 邮箱简单格式校验：非空时须含 @，且 @ 两侧非空（宽松校验，避免过度限制） */
function assertEmail(v: string | undefined | null): void {
  const email = v?.trim() ?? ''
  if (!email) return
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1 || email.includes(' ')) {
    throw new BizError('VALIDATION', '邮箱格式不正确')
  }
}

interface CustomerRow {
  id: number
  code: string
  name: string
  contact: string | null
  phone: string | null
  address: string | null
  price_level: string | null
  opening_receivable: number
  prepaid: number
  credit_limit: number | null
  email: string | null
  category: string
  remark: string | null
  disabled: number
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', `${field}不能为空`)
  }
  return v.trim()
}

function toEntity(row: CustomerRow): Customer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contact: row.contact ?? undefined,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    price_level: row.price_level ?? undefined,
    opening_receivable: row.opening_receivable,
    prepaid: row.prepaid,
    credit_limit: row.credit_limit,
    email: row.email ?? undefined,
    category: row.category ?? '',
    remark: row.remark ?? undefined,
    disabled: row.disabled === 1
  }
}

export function createCustomerService(db: DB) {
  const insertCustomer = db.prepare(`
    INSERT INTO customer (code, name, contact, phone, address, price_level, opening_receivable, credit_limit, email, category, remark)
    VALUES (@code, @name, @contact, @phone, @address, @price_level, @opening_receivable, @credit_limit, @email, @category, @remark)
  `)

  function assertCodeFree(code: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM customer WHERE code = ?').get(code) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_CODE', `编码已存在：${code}`)
    }
  }

  function getById(id: number): Customer | null {
    const row = db.prepare('SELECT * FROM customer WHERE id = ?').get(id) as
      | CustomerRow
      | undefined
    if (!row) return null
    return toEntity(row)
  }

  return {
    /** 客户详情聚合：基础信息 + 应收余额（ arrears 同口径） + 最近 20 笔交易。 */
    getDetail(id: number): {
      customer: Customer
      arrears: number
      transactions: Array<{ id: number; no: string; type: string; date: string; total_amount: number; status: string }>
    } | null {
      const customer = getById(id)
      if (!customer) return null
      const arrearsRow = db.prepare(`
        WITH traded AS (
          SELECT partner_id,
            SUM(CASE WHEN type = 'sale_return' THEN -total_amount ELSE total_amount END) AS amount
          FROM doc
          WHERE status = 'done' AND type IN ('sale', 'retail', 'sale_return')
          GROUP BY partner_id
        ),
        settled AS (
          SELECT d.partner_id,
            SUM(CASE WHEN f.doc_type = 'sale_return' THEN -f.amount ELSE f.amount END) AS amount
          FROM fund_flow f JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
          WHERE d.status = 'done' AND (
            (f.doc_type IN ('receipt', 'retail') AND f.direction = 'in')
            OR (f.doc_type = 'sale_return' AND f.direction = 'out' AND f.account_id = d.account_id)
          )
          GROUP BY d.partner_id
        )
        SELECT c.opening_receivable + COALESCE(t.amount, 0) - COALESCE(s.amount, 0) AS balance
        FROM customer c
        LEFT JOIN traded t ON t.partner_id = c.id
        LEFT JOIN settled s ON s.partner_id = c.id
        WHERE c.id = ?
      `).get(id) as { balance: number | null } | undefined
      const transactions = db.prepare(`
        SELECT id, no, type, date, total_amount, status FROM doc
        WHERE partner_id = ? AND type IN ('sale', 'retail', 'sale_return')
        ORDER BY date DESC, id DESC LIMIT 20
      `).all(id) as Array<{ id: number; no: string; type: string; date: string; total_amount: number; status: string }>
      return { customer, arrears: Number(arrearsRow?.balance ?? customer.opening_receivable), transactions }
    },

    create(c: Omit<Customer, 'id'>): number {
      const code = requireText(c.code, '编码')
      const name = requireText(c.name, '名称')
      // [4] 邮箱简单格式校验
      assertEmail(c.email)
      let id = 0
      db.transaction(() => {
        assertCodeFree(code)
        id = Number(
          insertCustomer.run({
            code,
            name,
            contact: c.contact ?? null,
            phone: c.phone ?? null,
            address: c.address ?? null,
            price_level: c.price_level ?? null,
            opening_receivable: c.opening_receivable ?? 0,
            credit_limit: c.credit_limit ?? null,
            email: c.email?.trim() ? c.email.trim() : null,
            category: c.category?.trim() ?? '',
            remark: c.remark ?? null
          }).lastInsertRowid
        )
      })()
      return id
    },

    update(id: number, c: Partial<Customer>): void {
      db.transaction(() => {
        const existing = db.prepare('SELECT id FROM customer WHERE id = ?').get(id) as
          | { id: number }
          | undefined
        if (!existing) throw new BizError('NOT_FOUND', '客户不存在')
        // [4] 邮箱简单格式校验
        assertEmail(c.email)

        const cols: string[] = []
        const vals: Record<string, unknown> = {}
        if (c.code !== undefined) {
          const code = requireText(c.code, '编码')
          assertCodeFree(code, id)
          cols.push('code = @code')
          vals['code'] = code
        }
        if (c.name !== undefined) {
          cols.push('name = @name')
          vals['name'] = requireText(c.name, '名称')
        }
        if (c.contact !== undefined) cols.push('contact = @contact'), (vals['contact'] = c.contact)
        if (c.phone !== undefined) cols.push('phone = @phone'), (vals['phone'] = c.phone)
        if (c.address !== undefined) cols.push('address = @address'), (vals['address'] = c.address)
        if (c.price_level !== undefined)
          cols.push('price_level = @price_level'), (vals['price_level'] = c.price_level)
        if (c.opening_receivable !== undefined)
          cols.push('opening_receivable = @opening_receivable'),
            (vals['opening_receivable'] = c.opening_receivable)
        if (c.credit_limit !== undefined)
          cols.push('credit_limit = @credit_limit'), (vals['credit_limit'] = c.credit_limit)
        // ── S 级功能批次 B：[4] 邮箱、[8] 分类 ──
        if (c.email !== undefined)
          cols.push('email = @email'), (vals['email'] = c.email?.trim() ? c.email.trim() : null)
        if (c.category !== undefined)
          cols.push('category = @category'), (vals['category'] = c.category?.trim() ?? '')
        if (c.remark !== undefined) cols.push('remark = @remark'), (vals['remark'] = c.remark)
        if (cols.length > 0) {
          cols.push("updated_at = datetime('now','localtime')")
          vals['id'] = id
          db.prepare(`UPDATE customer SET ${cols.join(', ')} WHERE id = @id`).run(vals)
        }
      })()
    },

    getById,

    disable(id: number): void {
      db.prepare(
        "UPDATE customer SET disabled = 1, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    enable(id: number): void {
      db.prepare(
        "UPDATE customer SET disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    remove(_id: number): void {
      throw new BizError('IN_USE', '客户档案不允许删除，请停用')
    },

    query(q: CustomerQuery): PageResult<Customer> {
      const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
      const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!q.includeDisabled) where.push('disabled = 0')
      if (q.keyword) {
        where.push('(code LIKE @kw OR name LIKE @kw OR phone LIKE @kw)')
        params['kw'] = `%${q.keyword}%`
      }
      // [8] 分类筛选（精确匹配，'' 表示未分类）
      if (q.category !== undefined && q.category !== '') {
        where.push('category = @category')
        params['category'] = q.category
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM customer ${whereSql}`).get(params) as { c: number }
        ).c
      )
      const rows = db
        .prepare(`SELECT * FROM customer ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as CustomerRow[]
      return { list: rows.map(toEntity), total }
    }
  }
}

export type CustomerService = ReturnType<typeof createCustomerService>
