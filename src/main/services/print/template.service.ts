// 打印模板服务（差距 8 简化版）：模板 CRUD + 同 kind 默认模板互斥。
// content 为 JSON 字符串，字段开关定义见 src/shared/print/templates.ts 的 PrintTemplateOptions。
import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

export type TemplateKind = 'receipt' | 'a4'

export interface TemplateInput {
  id?: number
  name: string
  kind: TemplateKind
  content: string
}

export interface TemplateRow extends TemplateInput {
  id: number
  is_default: number
}

function parseKind(v: unknown): TemplateKind {
  if (v === 'receipt' || v === 'a4') return v
  throw new BizError('VALIDATION', '模板类型无效')
}

function parseContent(v: unknown): string {
  if (typeof v !== 'string') throw new BizError('VALIDATION', '模板内容必须为 JSON 字符串')
  try {
    const parsed: unknown = JSON.parse(v)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
  } catch {
    throw new BizError('VALIDATION', '模板内容必须是合法的 JSON 对象')
  }
  return v
}

export function createPrintTemplateService(db: DB) {
  function assertNameFree(name: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM print_template WHERE name = ?').get(name) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_NAME', `模板名称已存在：${name}`)
    }
  }

  function toRow(r: {
    id: number
    name: string
    kind: string
    content: string
    is_default: number
  }): TemplateRow {
    return { id: r.id, name: r.name, kind: parseKind(r.kind), content: r.content, is_default: r.is_default }
  }

  function save(input: TemplateInput): number {
    const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : (() => { throw new BizError('VALIDATION', '模板名称不能为空') })()
    const kind = parseKind(input.kind)
    const content = parseContent(input.content)
    return db.transaction(() => {
      if (input.id !== undefined) {
        const existing = db.prepare('SELECT id FROM print_template WHERE id = ?').get(Number(input.id)) as
          | { id: number }
          | undefined
        if (!existing) throw new BizError('NOT_FOUND', `模板不存在：${input.id}`)
        assertNameFree(name, Number(input.id))
        db.prepare('UPDATE print_template SET name = ?, kind = ?, content = ? WHERE id = ?').run(name, kind, content, Number(input.id))
        return Number(input.id)
      }
      assertNameFree(name)
      return Number(
        db.prepare('INSERT INTO print_template (name, kind, content) VALUES (?, ?, ?)').run(name, kind, content).lastInsertRowid
      )
    })()
  }

  function list(): TemplateRow[] {
    return (db.prepare('SELECT * FROM print_template ORDER BY id').all() as Array<Parameters<typeof toRow>[0]>).map(toRow)
  }

  function remove(id: number): void {
    const r = db.prepare('DELETE FROM print_template WHERE id = ?').run(Number(id))
    if (r.changes === 0) throw new BizError('NOT_FOUND', `模板不存在：${id}`)
  }

  /** 设默认：同 kind 互斥（事务内先清后设）。 */
  function setDefault(id: number): void {
    db.transaction(() => {
      const row = db.prepare('SELECT id, kind FROM print_template WHERE id = ?').get(Number(id)) as
        | { id: number; kind: TemplateKind }
        | undefined
      if (!row) throw new BizError('NOT_FOUND', `模板不存在：${id}`)
      db.prepare('UPDATE print_template SET is_default = 0 WHERE kind = ? AND is_default = 1').run(row.kind)
      db.prepare('UPDATE print_template SET is_default = 1 WHERE id = ?').run(row.id)
    })()
  }

  /** 取某 kind 的默认模板；无则 undefined（渲染层回退现状行为）。 */
  function getDefault(kind: TemplateKind): TemplateRow | undefined {
    const row = db.prepare('SELECT * FROM print_template WHERE kind = ? AND is_default = 1').get(kind) as
      | Parameters<typeof toRow>[0]
      | undefined
    return row ? toRow(row) : undefined
  }

  return { save, list, remove, setDefault, getDefault }
}

export type PrintTemplateService = ReturnType<typeof createPrintTemplateService>
