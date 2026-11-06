import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PageResult } from '../../../shared/types/common'
import type { Supplier, SupplierQuery } from '../../../shared/types/supplier'

export type DB = Database

interface SupplierRow {
  id: number
  code: string
  name: string
  contact: string | null
  phone: string | null
  address: string | null
  opening_payable: number
  remark: string | null
  disabled: number
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', `${field}不能为空`)
  }
  return v.trim()
}

function toEntity(row: SupplierRow): Supplier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contact: row.contact ?? undefined,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    opening_payable: row.opening_payable,
    remark: row.remark ?? undefined,
    disabled: row.disabled === 1
  }
}

export function createSupplierService(db: DB) {
  const insertSupplier = db.prepare(`
    INSERT INTO supplier (code, name, contact, phone, address, opening_payable, remark)
    VALUES (@code, @name, @contact, @phone, @address, @opening_payable, @remark)
  `)

  function assertCodeFree(code: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM supplier WHERE code = ?').get(code) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_CODE', `编码已存在：${code}`)
    }
  }

  function getById(id: number): Supplier | null {
    const row = db.prepare('SELECT * FROM supplier WHERE id = ?').get(id) as
      | SupplierRow
      | undefined
    if (!row) return null
    return toEntity(row)
  }

  return {
    create(s: Omit<Supplier, 'id'>): number {
      const code = requireText(s.code, '编码')
      const name = requireText(s.name, '名称')
      let id = 0
      db.transaction(() => {
        assertCodeFree(code)
        id = Number(
          insertSupplier.run({
            code,
            name,
            contact: s.contact ?? null,
            phone: s.phone ?? null,
            address: s.address ?? null,
            opening_payable: s.opening_payable ?? 0,
            remark: s.remark ?? null
          }).lastInsertRowid
        )
      })()
      return id
    },

    update(id: number, s: Partial<Supplier>): void {
      db.transaction(() => {
        const existing = db.prepare('SELECT id FROM supplier WHERE id = ?').get(id) as
          | { id: number }
          | undefined
        if (!existing) throw new BizError('NOT_FOUND', '供应商不存在')

        const cols: string[] = []
        const vals: Record<string, unknown> = {}
        if (s.code !== undefined) {
          const code = requireText(s.code, '编码')
          assertCodeFree(code, id)
          cols.push('code = @code')
          vals['code'] = code
        }
        if (s.name !== undefined) {
          cols.push('name = @name')
          vals['name'] = requireText(s.name, '名称')
        }
        if (s.contact !== undefined) cols.push('contact = @contact'), (vals['contact'] = s.contact)
        if (s.phone !== undefined) cols.push('phone = @phone'), (vals['phone'] = s.phone)
        if (s.address !== undefined) cols.push('address = @address'), (vals['address'] = s.address)
        if (s.opening_payable !== undefined)
          cols.push('opening_payable = @opening_payable'),
            (vals['opening_payable'] = s.opening_payable)
        if (s.remark !== undefined) cols.push('remark = @remark'), (vals['remark'] = s.remark)
        if (cols.length > 0) {
          cols.push("updated_at = datetime('now','localtime')")
          vals['id'] = id
          db.prepare(`UPDATE supplier SET ${cols.join(', ')} WHERE id = @id`).run(vals)
        }
      })()
    },

    getById,

    disable(id: number): void {
      db.prepare(
        "UPDATE supplier SET disabled = 1, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    enable(id: number): void {
      db.prepare(
        "UPDATE supplier SET disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    remove(_id: number): void {
      throw new BizError('IN_USE', '供应商档案不允许删除，请停用')
    },

    query(q: SupplierQuery): PageResult<Supplier> {
      const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
      const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!q.includeDisabled) where.push('disabled = 0')
      if (q.keyword) {
        where.push('(code LIKE @kw OR name LIKE @kw OR phone LIKE @kw)')
        params['kw'] = `%${q.keyword}%`
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM supplier ${whereSql}`).get(params) as { c: number }
        ).c
      )
      const rows = db
        .prepare(`SELECT * FROM supplier ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as SupplierRow[]
      return { list: rows.map(toEntity), total }
    }
  }
}

export type SupplierService = ReturnType<typeof createSupplierService>
