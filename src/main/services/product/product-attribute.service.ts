// P2：商品自定义属性字典服务——属性（如 颜色）+ 可选值列表（JSON 数组字符串）。
// 商品.attributes 存 {attr_id: value} 映射，由 product.service 读写；本服务只管字典。
import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { ProductAttribute } from '../../../shared/types/product'

export type DB = Database

interface AttrRow {
  id: number
  name: string
  options: string
  created_at: string
}

/** 校验 options：必须是字符串数组 JSON，去重去空 */
function normalizeOptions(raw: unknown): string {
  let parsed: unknown
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new BizError('VALIDATION', '可选值必须为 JSON 数组字符串')
    }
  } else {
    parsed = raw
  }
  if (!Array.isArray(parsed)) throw new BizError('VALIDATION', '可选值必须为 JSON 数组')
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of parsed) {
    if (typeof v !== 'string') throw new BizError('VALIDATION', '可选值必须为字符串数组')
    const t = v.trim()
    if (t === '' || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return JSON.stringify(out)
}

export function createProductAttributeService(db: DB) {
  function toRow(r: AttrRow): ProductAttribute {
    return { id: r.id, name: r.name, options: r.options, created_at: r.created_at }
  }

  function assertNameFree(name: string, excludeId?: number): void {
    const row = db.prepare('SELECT id FROM product_attribute WHERE name = ?').get(name) as
      | { id: number }
      | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_NAME', `属性名已存在：${name}`)
    }
  }

  function getById(id: number): ProductAttribute {
    const row = db.prepare('SELECT * FROM product_attribute WHERE id = ?').get(Number(id)) as
      | AttrRow
      | undefined
    if (!row) throw new BizError('NOT_FOUND', `属性不存在：${id}`)
    return toRow(row)
  }

  function create(input: { name: string; options?: string | string[] }): ProductAttribute {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name) throw new BizError('VALIDATION', '属性名不能为空')
    const options = normalizeOptions(input.options ?? [])
    return db.transaction(() => {
      assertNameFree(name)
      const info = db
        .prepare('INSERT INTO product_attribute (name, options) VALUES (?, ?)')
        .run(name, options)
      return getById(Number(info.lastInsertRowid))
    })()
  }

  function update(id: number, input: { name?: string; options?: string | string[] }): ProductAttribute {
    return db.transaction(() => {
      const existing = getById(id)
      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new BizError('VALIDATION', '属性名不能为空')
        assertNameFree(name, Number(id))
        db.prepare('UPDATE product_attribute SET name = ? WHERE id = ?').run(name, Number(id))
      }
      if (input.options !== undefined) {
        db.prepare('UPDATE product_attribute SET options = ? WHERE id = ?').run(
          normalizeOptions(input.options),
          Number(id)
        )
      }
      void existing
      return getById(id)
    })()
  }

  function remove(id: number): void {
    // 引用检查：有商品使用该属性时拒绝删除
    const used = db
      .prepare(`SELECT COUNT(*) AS c FROM product WHERE json_extract(attributes, '$."${Number(id)}"') IS NOT NULL`)
      .get() as { c: number }
    if (Number(used.c) > 0) {
      throw new BizError('IN_USE', `属性仍被 ${used.c} 个商品使用，不能删除`)
    }
    const r = db.prepare('DELETE FROM product_attribute WHERE id = ?').run(Number(id))
    if (r.changes === 0) throw new BizError('NOT_FOUND', `属性不存在：${id}`)
  }

  function list(): ProductAttribute[] {
    return (db.prepare('SELECT * FROM product_attribute ORDER BY id').all() as AttrRow[]).map(toRow)
  }

  return { list, getById, create, update, remove }
}

export type ProductAttributeService = ReturnType<typeof createProductAttributeService>
