import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

/** P3：进出类别方向——in 入库类（进货/退货入库等），out 出库类（销售/领用等） */
export type FlowCategoryKind = 'in' | 'out'

export interface FlowCategory {
  id: number
  name: string
  kind: FlowCategoryKind
  disabled: boolean
  created_at: string
}

export interface FlowCategoryInput {
  name: string
  kind: FlowCategoryKind
}

interface FlowCategoryRow {
  id: number
  name: string
  kind: string
  disabled: number
  created_at: string
}

function toFlowCategory(row: FlowCategoryRow): FlowCategory {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'out' ? 'out' : 'in',
    disabled: row.disabled === 1,
    created_at: row.created_at
  }
}

function requireName(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', '类别名称不能为空')
  }
  const name = v.trim()
  if (name.length > 50) {
    throw new BizError('VALIDATION', '类别名称不能超过50个字符')
  }
  return name
}

function requireKind(v: unknown): FlowCategoryKind {
  if (v !== 'in' && v !== 'out') {
    throw new BizError('VALIDATION', '类别方向必须是 in（入库类）或 out（出库类）')
  }
  return v
}

export function createFlowCategoryService(db: DB) {
  function getById(id: number): FlowCategory | null {
    const row = db.prepare('SELECT * FROM flow_category WHERE id = ?').get(id) as
      | FlowCategoryRow
      | undefined
    return row ? toFlowCategory(row) : null
  }

  return {
    getById,

    create(input: FlowCategoryInput): number {
      const name = requireName(input.name)
      const kind = requireKind(input.kind)
      const dup = db.prepare('SELECT id FROM flow_category WHERE name = ?').get(name)
      if (dup) throw new BizError('DUP_CODE', `类别名称已存在：${name}`)
      return Number(
        db
          .prepare('INSERT INTO flow_category (name, kind) VALUES (?, ?)')
          .run(name, kind).lastInsertRowid
      )
    },

    update(id: number, input: Partial<FlowCategoryInput>): void {
      const existing = getById(id)
      if (!existing) throw new BizError('NOT_FOUND', `类别不存在：${id}`)
      if (input.name !== undefined) {
        const name = requireName(input.name)
        const dup = db
          .prepare('SELECT id FROM flow_category WHERE name = ? AND id != ?')
          .get(name, id)
        if (dup) throw new BizError('DUP_CODE', `类别名称已存在：${name}`)
        db.prepare('UPDATE flow_category SET name = ? WHERE id = ?').run(name, id)
      }
      if (input.kind !== undefined) {
        db.prepare('UPDATE flow_category SET kind = ? WHERE id = ?').run(
          requireKind(input.kind),
          id
        )
      }
    },

    remove(id: number): void {
      const r = db.prepare('DELETE FROM flow_category WHERE id = ?').run(id)
      if (r.changes === 0) throw new BizError('NOT_FOUND', `类别不存在：${id}`)
    },

    disable(id: number): void {
      const r = db.prepare('UPDATE flow_category SET disabled = 1 WHERE id = ?').run(id)
      if (r.changes === 0) throw new BizError('NOT_FOUND', `类别不存在：${id}`)
    },

    enable(id: number): void {
      const r = db.prepare('UPDATE flow_category SET disabled = 0 WHERE id = ?').run(id)
      if (r.changes === 0) throw new BizError('NOT_FOUND', `类别不存在：${id}`)
    },

    list(query?: { kind?: FlowCategoryKind; include_disabled?: boolean }): FlowCategory[] {
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!query?.include_disabled) where.push('disabled = 0')
      if (query?.kind) {
        where.push('kind = @kind')
        params['kind'] = query.kind
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const rows = db
        .prepare(`SELECT * FROM flow_category ${whereSql} ORDER BY kind, id`)
        .all(params) as FlowCategoryRow[]
      return rows.map(toFlowCategory)
    }
  }
}

export type FlowCategoryService = ReturnType<typeof createFlowCategoryService>
