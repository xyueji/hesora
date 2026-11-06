import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PageResult } from '../../../shared/types/common'
import type { Warehouse, WarehouseQuery } from '../../../shared/types/warehouse'

export type DB = Database

interface WarehouseRow {
  id: number
  code: string
  name: string
  address: string | null
  is_default: number
  remark: string | null
  disabled: number
  created_at: string
  updated_at: string | null
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', `${field}不能为空`)
  }
  return v.trim()
}

function toEntity(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address ?? undefined,
    is_default: row.is_default === 1,
    remark: row.remark ?? undefined,
    disabled: row.disabled === 1
  }
}

export function createWarehouseService(db: DB) {
  const insertWarehouse = db.prepare(`
    INSERT INTO warehouse (code, name, address, is_default, remark)
    VALUES (@code, @name, @address, @is_default, @remark)
  `)

  function assertNameFree(name: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM warehouse WHERE name = ?').get(name) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_CODE', '仓库名称已存在')
    }
  }

  function nextCode(): string {
    const row = db.prepare('SELECT COUNT(*) AS c FROM warehouse').get() as { c: number }
    return `WH${String(row.c + 1).padStart(3, '0')}`
  }

  function getById(id: number): Warehouse | null {
    const row = db.prepare('SELECT * FROM warehouse WHERE id = ?').get(id) as
      | WarehouseRow
      | undefined
    if (!row) return null
    return toEntity(row)
  }

  return {
    create(w: Omit<Warehouse, 'id'>): number {
      const name = requireText(w.name, '名称')
      let id = 0
      db.transaction(() => {
        assertNameFree(name)
        const count = Number(
          (db.prepare('SELECT COUNT(*) AS c FROM warehouse').get() as { c: number }).c
        )
        // First warehouse automatically becomes the default.
        const isDefault = count === 0 ? 1 : w.is_default ? 1 : 0
        if (isDefault === 1) {
          db.prepare('UPDATE warehouse SET is_default = 0').run()
        }
        const code = w.code !== undefined && w.code !== '' ? requireText(w.code, '编码') : nextCode()
        id = Number(
          insertWarehouse.run({
            code,
            name,
            address: w.address ?? null,
            is_default: isDefault,
            remark: w.remark ?? null
          }).lastInsertRowid
        )
      })()
      return id
    },

    update(id: number, w: Partial<Warehouse>): void {
      db.transaction(() => {
        const existing = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(id) as
          | { id: number }
          | undefined
        if (!existing) throw new BizError('NOT_FOUND', '仓库不存在')

        const cols: string[] = []
        const vals: Record<string, unknown> = {}
        if (w.code !== undefined && w.code !== '') {
          cols.push('code = @code')
          vals['code'] = requireText(w.code, '编码')
        }
        if (w.name !== undefined) {
          const name = requireText(w.name, '名称')
          assertNameFree(name, id)
          cols.push('name = @name')
          vals['name'] = name
        }
        if (w.is_default !== undefined) {
          if (w.is_default) {
            db.prepare('UPDATE warehouse SET is_default = 0').run()
          }
          cols.push('is_default = @is_default')
          vals['is_default'] = w.is_default ? 1 : 0
        }
        if (w.remark !== undefined) cols.push('remark = @remark'), (vals['remark'] = w.remark)
        if (cols.length > 0) {
          cols.push("updated_at = datetime('now','localtime')")
          vals['id'] = id
          db.prepare(`UPDATE warehouse SET ${cols.join(', ')} WHERE id = @id`).run(vals)
        }
      })()
    },

    setDefault(id: number): void {
      db.transaction(() => {
        const row = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(id) as
          | { id: number }
          | undefined
        if (!row) throw new BizError('NOT_FOUND', '仓库不存在')
        db.prepare('UPDATE warehouse SET is_default = 0').run()
        db.prepare(
          "UPDATE warehouse SET is_default = 1, updated_at = datetime('now','localtime') WHERE id = ?"
        ).run(id)
      })()
    },

    getById,

    disable(id: number): void {
      const row = db.prepare('SELECT is_default FROM warehouse WHERE id = ?').get(id) as
        | { is_default: number }
        | undefined
      if (!row) throw new BizError('NOT_FOUND', '仓库不存在')
      if (row.is_default === 1) {
        throw new BizError('VALIDATION', '默认仓库不允许停用')
      }
      db.prepare(
        "UPDATE warehouse SET disabled = 1, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    enable(id: number): void {
      db.prepare(
        "UPDATE warehouse SET disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
    },

    remove(_id: number): void {
      throw new BizError('IN_USE', '仓库档案不允许删除，请停用')
    },

    query(q: WarehouseQuery): PageResult<Warehouse> {
      const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
      const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!q.includeDisabled) where.push('disabled = 0')
      if (q.keyword) {
        where.push('(code LIKE @kw OR name LIKE @kw)')
        params['kw'] = `%${q.keyword}%`
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM warehouse ${whereSql}`).get(params) as { c: number }
        ).c
      )
      const rows = db
        .prepare(`SELECT * FROM warehouse ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as WarehouseRow[]
      return { list: rows.map(toEntity), total }
    }
  }
}

export type WarehouseService = ReturnType<typeof createWarehouseService>
