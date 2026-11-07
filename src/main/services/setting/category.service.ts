import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

export type CategoryKind = 'income' | 'expense'

export interface CategoryRow {
  id: number
  name: string
  kind: CategoryKind
  disabled: 0 | 1
  created_at: string
}

export interface CategoryListQuery {
  /** 默认 true；false 时只返回未停用科目 */
  include_disabled?: boolean
  kind?: CategoryKind
}

export interface CategoryCreateInput {
  name: string
  kind: CategoryKind
}

export interface CategoryUpdateInput {
  name?: string
  kind?: CategoryKind
}

interface CategoryDbRow {
  id: number
  name: string
  kind: string
  disabled: number
  created_at: string
}

/**
 * 收支科目主档（income_category）：其他收入/其他支出等资金单据的科目字典。
 * 纯主档管理，不改动任何单据表——单据侧按需引用科目名称（如 doc.remark 前缀）。
 */
export function createCategoryService(db: DB) {
  const selectById = db.prepare('SELECT * FROM income_category WHERE id = ?')

  function toRow(r: CategoryDbRow): CategoryRow {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as CategoryKind,
      disabled: r.disabled ? 1 : 0,
      created_at: r.created_at
    }
  }

  function create(input: CategoryCreateInput): number {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name) throw new BizError('VALIDATION', '科目名称不能为空')
    if (name.length > 50) throw new BizError('VALIDATION', '科目名称过长')
    if (input?.kind !== 'income' && input?.kind !== 'expense') {
      throw new BizError('VALIDATION', '科目类型无效')
    }
    const exists = db.prepare('SELECT id FROM income_category WHERE name = ?').get(name)
    if (exists) throw new BizError('DUP_CODE', `科目已存在：${name}`)
    return Number(
      db.prepare('INSERT INTO income_category (name, kind) VALUES (?, ?)').run(name, input.kind)
        .lastInsertRowid
    )
  }

  function update(id: number, input: CategoryUpdateInput): void {
    const row = selectById.get(Number(id)) as CategoryDbRow | undefined
    if (!row) throw new BizError('NOT_FOUND', `科目不存在：${id}`)
    const name = input?.name === undefined ? row.name : String(input.name).trim()
    const kind = input?.kind ?? (row.kind as CategoryKind)
    if (!name) throw new BizError('VALIDATION', '科目名称不能为空')
    if (name.length > 50) throw new BizError('VALIDATION', '科目名称过长')
    if (kind !== 'income' && kind !== 'expense') throw new BizError('VALIDATION', '科目类型无效')
    if (name !== row.name || kind !== row.kind) {
      const dup = db.prepare('SELECT id FROM income_category WHERE name = ? AND id <> ?').get(name, Number(id))
      if (dup) throw new BizError('DUP_CODE', `科目已存在：${name}`)
    }
    db.prepare('UPDATE income_category SET name = ?, kind = ? WHERE id = ?').run(name, kind, Number(id))
  }

  function remove(id: number): void {
    const res = db.prepare('DELETE FROM income_category WHERE id = ?').run(Number(id))
    if (res.changes === 0) throw new BizError('NOT_FOUND', `科目不存在：${id}`)
  }

  function disable(id: number): void {
    const res = db.prepare('UPDATE income_category SET disabled = 1 WHERE id = ?').run(Number(id))
    if (res.changes === 0) throw new BizError('NOT_FOUND', `科目不存在：${id}`)
  }

  function enable(id: number): void {
    const res = db.prepare('UPDATE income_category SET disabled = 0 WHERE id = ?').run(Number(id))
    if (res.changes === 0) throw new BizError('NOT_FOUND', `科目不存在：${id}`)
  }

  function list(query?: CategoryListQuery): CategoryRow[] {
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (query?.include_disabled === false) conditions.push('disabled = 0')
    if (query?.kind) {
      conditions.push('kind = ?')
      params.push(query.kind)
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db
      .prepare(`SELECT * FROM income_category ${whereSql} ORDER BY kind, name`)
      .all(...params) as CategoryDbRow[]
    return rows.map(toRow)
  }

  return { create, update, remove, disable, enable, list }
}

export type CategoryService = ReturnType<typeof createCategoryService>
