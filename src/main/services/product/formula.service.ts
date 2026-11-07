import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

export interface FormulaItemRow {
  id: number
  formula_id: number
  product_id: number
  qty: number
}

export interface FormulaRow {
  id: number
  name: string
  output_product_id: number
  output_qty: number
  remark: string | null
  disabled: 0 | 1
  created_at: string
  updated_at: string | null
  items: FormulaItemRow[]
}

export interface FormulaItemInput {
  product_id: number
  qty: number
}

export interface FormulaCreateInput {
  name: string
  output_product_id: number
  output_qty?: number
  remark?: string
  items: FormulaItemInput[]
}

export interface FormulaUpdateInput {
  name?: string
  output_product_id?: number
  output_qty?: number
  remark?: string | null
  items?: FormulaItemInput[]
}

interface FormulaDbRow {
  id: number
  name: string
  output_product_id: number
  output_qty: number
  remark: string | null
  disabled: number
  created_at: string
  updated_at: string | null
}

/**
 * 独立配方档案（formula/formula_item）：配方不再绑死在组合商品 BOM 上，可复用。
 * 组装单可选 formula_id，按配方 output_qty×单据数量计算子件用量；未指定配方时
 * 维持既有 BOM 逻辑（见 assemble.service）。
 *
 * 产出商品选择说明：output_product_id 允许 kind='standard' 或 'combo' —— 配方是
 * 描述"投入子件→产出成品"关系的独立档案，产出组合商品时配方与 BOM 可共存
 * （组装单指定配方则优先按配方用量）。
 */
export function createFormulaService(db: DB) {
  const selectById = db.prepare('SELECT * FROM formula WHERE id = ?')
  const selectItems = db.prepare('SELECT * FROM formula_item WHERE formula_id = ? ORDER BY id')
  const selectProduct = db.prepare('SELECT id, kind, name FROM product WHERE id = ?')

  function validateItems(items: FormulaItemInput[]): FormulaItemInput[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BizError('VALIDATION', '配方子件不能为空')
    }
    const seen = new Set<number>()
    for (const it of items) {
      const pid = Number(it?.product_id)
      const qty = Number(it?.qty)
      if (!Number.isInteger(pid)) throw new BizError('VALIDATION', '配方子件商品不能为空')
      if (!Number.isFinite(qty) || qty <= 0) throw new BizError('VALIDATION', '配方子件数量必须大于0')
      const child = selectProduct.get(pid) as { id: number; name: string } | undefined
      if (!child) throw new BizError('NOT_FOUND', `商品不存在：${pid}`)
      if (seen.has(pid)) throw new BizError('VALIDATION', `配方子件重复：${child.name}`)
      seen.add(pid)
    }
    return items.map((it) => ({ product_id: Number(it.product_id), qty: Number(it.qty) }))
  }

  function toRow(r: FormulaDbRow): FormulaRow {
    return {
      id: r.id,
      name: r.name,
      output_product_id: r.output_product_id,
      output_qty: r.output_qty,
      remark: r.remark,
      disabled: r.disabled ? 1 : 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
      items: selectItems.all(r.id) as FormulaItemRow[]
    }
  }

  function create(input: FormulaCreateInput): number {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name) throw new BizError('VALIDATION', '配方名称不能为空')
    if (name.length > 100) throw new BizError('VALIDATION', '配方名称过长')
    const outputId = Number(input?.output_product_id)
    if (!Number.isInteger(outputId)) throw new BizError('VALIDATION', '产出商品不能为空')
    const product = selectProduct.get(outputId) as { id: number; kind: string } | undefined
    if (!product) throw new BizError('NOT_FOUND', `产出商品不存在：${outputId}`)
    if (product.kind !== 'standard' && product.kind !== 'combo') {
      throw new BizError('VALIDATION', '产出商品类型无效')
    }
    const outputQty = input?.output_qty === undefined ? 1 : Number(input.output_qty)
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      throw new BizError('VALIDATION', '产出数量必须大于0')
    }
    const items = validateItems(input?.items ?? [])
    return db.transaction(() => {
      const dup = db.prepare('SELECT id FROM formula WHERE name = ?').get(name)
      if (dup) throw new BizError('DUP_CODE', `配方已存在：${name}`)
      const id = Number(
        db
          .prepare(
            'INSERT INTO formula (name, output_product_id, output_qty, remark) VALUES (?, ?, ?, ?)'
          )
          .run(name, outputId, outputQty, input?.remark ?? null).lastInsertRowid
      )
      const insertItem = db.prepare('INSERT INTO formula_item (formula_id, product_id, qty) VALUES (?, ?, ?)')
      for (const it of items) insertItem.run(id, it.product_id, it.qty)
      return id
    })()
  }

  function getById(id: number): FormulaRow | null {
    const row = selectById.get(Number(id)) as FormulaDbRow | undefined
    return row ? toRow(row) : null
  }

  function update(id: number, input: FormulaUpdateInput): void {
    const row = selectById.get(Number(id)) as FormulaDbRow | undefined
    if (!row) throw new BizError('NOT_FOUND', `配方不存在：${id}`)
    const name = input?.name === undefined ? row.name : String(input.name).trim()
    if (!name) throw new BizError('VALIDATION', '配方名称不能为空')
    if (name.length > 100) throw new BizError('VALIDATION', '配方名称过长')
    const outputId = input?.output_product_id === undefined ? row.output_product_id : Number(input.output_product_id)
    if (!Number.isInteger(outputId)) throw new BizError('VALIDATION', '产出商品不能为空')
    const product = selectProduct.get(outputId) as { id: number; kind: string } | undefined
    if (!product) throw new BizError('NOT_FOUND', `产出商品不存在：${outputId}`)
    if (product.kind !== 'standard' && product.kind !== 'combo') {
      throw new BizError('VALIDATION', '产出商品类型无效')
    }
    const outputQty =
      input?.output_qty === undefined ? row.output_qty : Number(input.output_qty)
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      throw new BizError('VALIDATION', '产出数量必须大于0')
    }
    if (name !== row.name) {
      const dup = db.prepare('SELECT id FROM formula WHERE name = ? AND id <> ?').get(name, Number(id))
      if (dup) throw new BizError('DUP_CODE', `配方已存在：${name}`)
    }
    db.transaction(() => {
      db.prepare(
        "UPDATE formula SET name = ?, output_product_id = ?, output_qty = ?, remark = ?, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(
        name,
        outputId,
        outputQty,
        input?.remark === undefined ? row.remark : input.remark,
        Number(id)
      )
      if (input?.items !== undefined) {
        const items = validateItems(input.items)
        db.prepare('DELETE FROM formula_item WHERE formula_id = ?').run(Number(id))
        const insertItem = db.prepare('INSERT INTO formula_item (formula_id, product_id, qty) VALUES (?, ?, ?)')
        for (const it of items) insertItem.run(Number(id), it.product_id, it.qty)
      }
    })()
  }

  function remove(id: number): void {
    db.transaction(() => {
      db.prepare('DELETE FROM formula_item WHERE formula_id = ?').run(Number(id))
      const res = db.prepare('DELETE FROM formula WHERE id = ?').run(Number(id))
      if (res.changes === 0) throw new BizError('NOT_FOUND', `配方不存在：${id}`)
    })()
  }

  function disable(id: number): void {
    const res = db.prepare('UPDATE formula SET disabled = 1 WHERE id = ?').run(Number(id))
    if (res.changes === 0) throw new BizError('NOT_FOUND', `配方不存在：${id}`)
  }

  function enable(id: number): void {
    const res = db.prepare('UPDATE formula SET disabled = 0 WHERE id = ?').run(Number(id))
    if (res.changes === 0) throw new BizError('NOT_FOUND', `配方不存在：${id}`)
  }

  function list(query?: { include_disabled?: boolean }): FormulaRow[] {
    const whereSql = query?.include_disabled === false ? 'WHERE disabled = 0' : ''
    const rows = db
      .prepare(`SELECT * FROM formula ${whereSql} ORDER BY id DESC`)
      .all() as FormulaDbRow[]
    return rows.map(toRow)
  }

  return { create, update, remove, disable, enable, getById, list }
}

export type FormulaService = ReturnType<typeof createFormulaService>
