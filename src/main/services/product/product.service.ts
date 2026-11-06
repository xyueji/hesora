import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { PageResult } from '../../../shared/types/common'
import type { Product, ProductKind, ProductQuery, ProductUnit } from '../../../shared/types/product'
import type { BomItem } from '../../../shared/types/product'

export type DB = Database

interface ProductRow {
  id: number
  code: string
  name: string
  spec: string | null
  category: string | null
  base_unit: string
  retail_price: number
  trade_price: number
  purchase_price: number
  min_stock: number | null
  images: string | null
  remark: string | null
  tracking_type: string
  kind: string
  disabled: number
}

interface BomRow {
  product_id: number
  qty: number
}

interface UnitRow {
  unit: string
  rate: number
  is_base: number
}

interface BarcodeRow {
  barcode: string
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BizError('VALIDATION', `${field}不能为空`)
  }
  return v.trim()
}

function parseImages(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    /* corrupted json treated as empty */
  }
  return []
}

export function createProductService(db: DB) {
  const insertProduct = db.prepare(`
    INSERT INTO product (code, name, spec, category, base_unit, retail_price, trade_price, purchase_price, min_stock, images, remark, tracking_type, kind)
    VALUES (@code, @name, @spec, @category, @base_unit, @retail_price, @trade_price, @purchase_price, @min_stock, @images, @remark, @tracking_type, @kind)
  `)
  const insertUnit = db.prepare(
    'INSERT INTO product_unit (product_id, unit, rate, is_base) VALUES (?, ?, ?, 0)'
  )
  const insertBarcode = db.prepare(
    'INSERT INTO product_barcode (product_id, barcode) VALUES (?, ?)'
  )
  const deleteUnits = db.prepare('DELETE FROM product_unit WHERE product_id = ?')
  const deleteBarcodes = db.prepare('DELETE FROM product_barcode WHERE product_id = ?')
  const deleteBom = db.prepare('DELETE FROM bom_item WHERE combo_id = ?')
  const insertBom = db.prepare('INSERT INTO bom_item (combo_id, product_id, qty) VALUES (?, ?, ?)')

  // 校验并整体替换组合商品 BOM。要求：非空；子件存在且为标准商品；qty > 0。
  function writeBom(comboId: number, bom: BomItem[]): void {
    if (!Array.isArray(bom) || bom.length === 0) {
      throw new BizError('VALIDATION', '组合商品必须至少配置一个子件')
    }
    const selectChild = db.prepare('SELECT id, kind FROM product WHERE id = ?')
    const seen = new Set<number>()
    for (const it of bom) {
      const pid = Number(it.product_id)
      if (!Number.isInteger(pid)) {
        throw new BizError('VALIDATION', '子件商品不能为空')
      }
      if (pid === comboId) {
        throw new BizError('VALIDATION', '组合商品不能以自身作为子件')
      }
      if (seen.has(pid)) {
        throw new BizError('VALIDATION', `子件商品重复：${pid}`)
      }
      seen.add(pid)
      const child = selectChild.get(pid) as { id: number; kind: string } | undefined
      if (!child) throw new BizError('NOT_FOUND', `子件商品不存在：${pid}`)
      if (child.kind !== 'standard') {
        throw new BizError('VALIDATION', '子件必须是标准商品，不能嵌套组合商品')
      }
      const qty = Number(it.qty)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BizError('VALIDATION', '子件用量必须大于0')
      }
    }
    deleteBom.run(comboId)
    for (const it of bom) insertBom.run(comboId, Number(it.product_id), Number(it.qty))
  }

  function writeUnits(id: number, units: ProductUnit[]): void {
    deleteUnits.run(id)
    for (const u of units) {
      const unit = requireText(u.unit, '单位')
      const rate = Number(u.rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new BizError('VALIDATION', `单位「${unit}」的换算率必须大于 0`)
      }
      // base unit lives in product.base_unit; store only non-base unit rows
      if (u.is_base) continue
      insertUnit.run(id, unit, rate)
    }
  }

  function writeBarcodes(id: number, barcodes: string[]): void {
    deleteBarcodes.run(id)
    for (const b of barcodes) {
      const code = requireText(b, '条码')
      insertBarcode.run(id, code)
    }
  }

  function assertCodeFree(code: string, excludeId?: number): void {
    const row = db
      .prepare('SELECT id FROM product WHERE code = ?')
      .get(code) as { id: number } | undefined
    if (row && row.id !== excludeId) {
      throw new BizError('DUP_CODE', `编码已存在：${code}`)
    }
  }

  function getById(id: number): Product | null {
    const row = db.prepare('SELECT * FROM product WHERE id = ?').get(id) as
      | ProductRow
      | undefined
    if (!row) return null
    const units = db
      .prepare('SELECT unit, rate, is_base FROM product_unit WHERE product_id = ? ORDER BY id')
      .all(id) as UnitRow[]
    const barcodes = db
      .prepare('SELECT barcode FROM product_barcode WHERE product_id = ? ORDER BY id')
      .all(id) as BarcodeRow[]
    const kind = (row.kind === 'combo' ? 'combo' : 'standard') as ProductKind
    const bom =
      kind === 'combo'
        ? (db
            .prepare('SELECT product_id, qty FROM bom_item WHERE combo_id = ? ORDER BY id')
            .all(id) as BomRow[]).map((b) => ({ product_id: b.product_id, qty: b.qty }))
        : undefined
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      spec: row.spec ?? undefined,
      category: row.category ?? undefined,
      base_unit: row.base_unit,
      retail_price: row.retail_price,
      trade_price: row.trade_price,
      purchase_price: row.purchase_price,
      min_stock: row.min_stock,
      images: parseImages(row.images),
      remark: row.remark ?? undefined,
      tracking_type: row.tracking_type as Product['tracking_type'],
      kind,
      bom,
      units: units.map((u) => ({ unit: u.unit, rate: u.rate })),
      barcodes: barcodes.map((b) => b.barcode),
      disabled: row.disabled === 1
    }
  }

  return {
    create(p: Omit<Product, 'id'>): number {
      const code = requireText(p.code, '编码')
      const name = requireText(p.name, '名称')
      const baseUnit = requireText(p.base_unit, '基本单位')
      let id = 0
      db.transaction(() => {
        assertCodeFree(code)
        id = Number(
          insertProduct.run({
            code,
            name,
            spec: p.spec ?? null,
            category: p.category ?? null,
            base_unit: baseUnit,
            retail_price: p.retail_price ?? 0,
            trade_price: p.trade_price ?? 0,
            purchase_price: p.purchase_price ?? 0,
            min_stock: p.min_stock ?? null,
            images: p.images === undefined ? null : JSON.stringify(p.images),
            remark: p.remark ?? null,
            tracking_type: p.tracking_type ?? 'none',
            kind: p.kind ?? 'standard'
          }).lastInsertRowid
        )
        writeUnits(id, p.units ?? [])
        writeBarcodes(id, p.barcodes ?? [])
        if ((p.kind ?? 'standard') === 'combo') writeBom(id, p.bom ?? [])
      })()
      return id
    },

    update(id: number, p: Partial<Product>): void {
      db.transaction(() => {
        const existing = db
          .prepare('SELECT id, code FROM product WHERE id = ?')
          .get(id) as { id: number; code: string } | undefined
        if (!existing) throw new BizError('NOT_FOUND', '商品不存在')

        const cols: string[] = []
        const vals: Record<string, unknown> = {}
        if (p.code !== undefined) {
          const code = requireText(p.code, '编码')
          assertCodeFree(code, id)
          cols.push('code = @code')
          vals['code'] = code
        }
        if (p.name !== undefined) {
          cols.push('name = @name')
          vals['name'] = requireText(p.name, '名称')
        }
        if (p.spec !== undefined) cols.push('spec = @spec'), (vals['spec'] = p.spec)
        if (p.category !== undefined) (cols.push('category = @category')), (vals['category'] = p.category)
        if (p.base_unit !== undefined) {
          cols.push('base_unit = @base_unit')
          vals['base_unit'] = requireText(p.base_unit, '基本单位')
        }
        if (p.retail_price !== undefined) (cols.push('retail_price = @retail_price')), (vals['retail_price'] = p.retail_price)
        if (p.trade_price !== undefined) (cols.push('trade_price = @trade_price')), (vals['trade_price'] = p.trade_price)
        if (p.purchase_price !== undefined) (cols.push('purchase_price = @purchase_price')), (vals['purchase_price'] = p.purchase_price)
        if (p.min_stock !== undefined) cols.push('min_stock = @min_stock'), (vals['min_stock'] = p.min_stock)
        if (p.images !== undefined) cols.push('images = @images'), (vals['images'] = JSON.stringify(p.images))
        if (p.remark !== undefined) cols.push('remark = @remark'), (vals['remark'] = p.remark)
        if (p.tracking_type !== undefined) (cols.push('tracking_type = @tracking_type')), (vals['tracking_type'] = p.tracking_type)
        if (p.kind !== undefined) cols.push('kind = @kind'), (vals['kind'] = p.kind)
        if (cols.length > 0) {
          cols.push("updated_at = datetime('now','localtime')")
          vals['id'] = id
          db.prepare(`UPDATE product SET ${cols.join(', ')} WHERE id = @id`).run(vals)
        }
        if (p.units !== undefined) writeUnits(id, p.units)
        if (p.barcodes !== undefined) writeBarcodes(id, p.barcodes)
        if (p.kind !== undefined || p.bom !== undefined) {
          const kindRow = db.prepare('SELECT kind FROM product WHERE id = ?').get(id) as
            | { kind: string }
            | undefined
          if (kindRow?.kind === 'combo') writeBom(id, p.bom ?? [])
        }
      })()
    },

    getById,

    disable(id: number): void {
      db.prepare("UPDATE product SET disabled = 1, updated_at = datetime('now','localtime') WHERE id = ?").run(id)
    },

    enable(id: number): void {
      db.prepare("UPDATE product SET disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(id)
    },

    remove(_id: number): void {
      throw new BizError('IN_USE', '主档不允许删除，请停用')
    },

    query(q: ProductQuery): PageResult<Product> {
      const pageSize = Math.min(Math.max(Math.trunc(Number(q.pageSize) || 20), 1), 200)
      const page = Math.max(Math.trunc(Number(q.page) || 1), 1)
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (!q.includeDisabled) where.push('disabled = 0')
      if (q.category) {
        where.push('category = @category')
        params['category'] = q.category
      }
      if (q.kind) {
        where.push('kind = @kind')
        params['kind'] = q.kind
      }
      if (q.keyword) {
        where.push(
          '(code LIKE @kw OR name LIKE @kw OR id IN (SELECT product_id FROM product_barcode WHERE barcode LIKE @kw))'
        )
        params['kw'] = `%${q.keyword}%`
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM product ${whereSql}`).get(params) as {
            c: number
          }
        ).c
      )
      const rows = db
        .prepare(`SELECT id FROM product ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as { id: number }[]
      const list = rows
        .map((r) => getById(r.id))
        .filter((p): p is Product => p !== null)
      return { list, total }
    }
  }
}

export type ProductService = ReturnType<typeof createProductService>
