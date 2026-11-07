import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { InventoryChange, InventoryRow } from '../../../shared/types/inventory'
import type {
  StocktakeCreateInput,
  StocktakeItemInput,
  StocktakeQuery,
  StocktakeSheetRow
} from '../../../shared/types/stocktake'

export type DB = Database

export interface StocktakeDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 盘点单：按仓库生成账面库存表，录入实盘数量后一次提交。
 * diff = 实盘(基准单位) - 账面：>0 盘盈 IN（成本取账面 moving_cost，无记录为 0）、
 * <0 盘亏 OUT、=0 跳过。doc（type='stocktake'，编号 PDyyyyMMddNNNN）只记录
 * 有差异的明细，qty 存差异量，price 为 0。同一事务内创建单据并 applyChanges。
 */
export function createStocktakeService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const selectWh = db.prepare('SELECT id FROM warehouse WHERE id = ?')

  // 账面库存表：该仓库所有 qty<>0 的批次，含商品信息（直接 SQL，带 keyword 过滤）
  function getSheet(warehouse_id: number, keyword?: string): StocktakeSheetRow[] {
    const conditions = ['i.qty <> 0', 'i.warehouse_id = ?']
    const params: Array<string | number> = [Number(warehouse_id)]
    if (keyword && keyword.trim()) {
      conditions.push('(p.code LIKE ? OR p.name LIKE ?)')
      const kw = `%${keyword.trim()}%`
      params.push(kw, kw)
    }
    const rows = db
      .prepare(
        `SELECT
          i.product_id,
          p.code AS product_code,
          p.name AS product_name,
          p.base_unit AS unit,
          i.batch_no,
          i.qty AS book_qty,
          i.moving_cost,
          (
            SELECT GROUP_CONCAT(u.unit || '=' || RTRIM(RTRIM(CAST(u.rate AS TEXT), '0'), '.'), ';')
            FROM product_unit u
            WHERE u.product_id = i.product_id AND u.is_base = 0
          ) AS spec
        FROM inventory i
        JOIN product p ON p.id = i.product_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.code, i.batch_no`
      )
      .all(...params) as Array<{
      product_id: number
      product_code: string
      product_name: string
      unit: string
      batch_no: string
      book_qty: number
      moving_cost: number
      spec: string | null
    }>
    return rows.map((r) => ({
      product_id: r.product_id,
      product_code: r.product_code,
      product_name: r.product_name,
      spec: r.spec ?? '',
      unit: r.unit,
      batch_no: r.batch_no,
      book_qty: r.book_qty,
      moving_cost: r.moving_cost
    }))
  }

  function create(input: StocktakeCreateInput): DocRow {
    const whId = Number(input.warehouse_id)
    if (!Number.isInteger(whId)) throw new BizError('VALIDATION', '仓库不能为空')
    if (!selectWh.get(whId)) throw new BizError('NOT_FOUND', `仓库不存在：${whId}`)
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '盘点明细不能为空')
    }
    const counted = new Set<string>()
    for (const it of input.items) {
      const qty = Number(it.actual_qty)
      if (!Number.isFinite(qty) || qty < 0) {
        throw new BizError('VALIDATION', '实盘数量不能小于0')
      }
      const rate = Number(it.rate ?? 1)
      if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty * rate)) {
        throw new BizError('VALIDATION', '明细单位换算率无效')
      }
      const key = JSON.stringify([Number(it.product_id), it.batch_no ?? ''])
      if (counted.has(key)) throw new BizError('VALIDATION', '同一商品和批次不可重复盘点')
      counted.add(key)
    }

    let doc: DocRow | undefined
    db.transaction(() => {
      const selectInv = db.prepare(
        'SELECT qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
      )
      interface Diff {
        item: StocktakeItemInput
        diff: number
        unit_cost: number
      }
      const diffs: Diff[] = []
      for (const it of input.items) {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const baseActual = Number(it.actual_qty) * rate
        const row = selectInv.get(
          Number(it.product_id),
          whId,
          it.batch_no ?? ''
        ) as Pick<InventoryRow, 'qty' | 'moving_cost'> | undefined
        const bookQty = row ? row.qty : 0
        const diff = baseActual - bookQty
        if (diff !== 0) {
          diffs.push({ item: it, diff, unit_cost: row ? row.moving_cost : 0 })
        }
      }
      if (diffs.length === 0) {
        throw new BizError('VALIDATION', '无差异，无需生成盘点单')
      }

      doc = docService.create({
        type: 'stocktake',
        date: input.date,
        warehouse_id: whId,
        remark: input.remark,
        items: diffs.map((d) => ({
          product_id: d.item.product_id,
          warehouse_id: whId,
          batch_no: d.item.batch_no,
          unit: d.item.unit,
          rate: d.item.rate,
          qty: Math.abs(d.diff) / Number(d.item.rate ?? 1),
          price: 0
        }))
      })
      const sourceId = doc?.id ?? 0
      const changes: InventoryChange[] = diffs.map((d) => ({
        product_id: d.item.product_id,
        warehouse_id: whId,
        batch_no: d.item.batch_no ?? '',
        change_qty: d.diff,
        unit_cost: d.diff > 0 ? d.unit_cost : undefined,
        source: 'stocktake',
        source_id: sourceId
      }))
      inventoryService.applyChanges(changes)
    }).immediate()
    return doc as DocRow
  }

  function getDetail(id: number): StocktakeDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'stocktake') {
      throw new BizError('NOT_FOUND', `盘点单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: StocktakeQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'stocktake',
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      page: q.page,
      pageSize: q.pageSize
    }
    return docService.query(inner)
  }

  return { getSheet, create, getDetail, query }
}

export type StocktakeService = ReturnType<typeof createStocktakeService>
