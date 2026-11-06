import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'

export type DB = Database

export interface PurchaseItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

export interface PurchaseCreateInput {
  supplier_id?: number
  warehouse_id: number
  date?: string
  remark?: string
  items: PurchaseItemInput[]
}

export interface PurchaseQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  page: number
  pageSize: number
}

export interface PurchaseDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 采购单：单据（doc/doc_item，type='purchase'，编号 CGyyyyMMddNNNN）+ 入库（inventory/cost_log），
 * 二者写在一个事务里，保证单据与库存原子一致。
 * rate 语义：1 个录入单位 = rate 个基本单位；change_qty = qty*rate，unit_cost = price/rate（每基本单位成本）。
 */
export function createPurchaseService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)

  function create(input: PurchaseCreateInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.supplier_id !== undefined && input.supplier_id !== null) {
      const sup = db.prepare('SELECT id FROM supplier WHERE id = ?').get(Number(input.supplier_id))
      if (!sup) throw new BizError('NOT_FOUND', `供应商不存在：${input.supplier_id}`)
    }
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '采购明细不能为空')
    }
    for (const it of input.items) {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        throw new BizError('VALIDATION', '明细数量必须大于0')
      }
      const price = Number(it.price ?? 0)
      if (!Number.isFinite(price) || price < 0) {
        throw new BizError('VALIDATION', '明细单价不能为负数')
      }
    }
    let doc: DocRow | undefined
    db.transaction(() => {
      doc = docService.create({
        type: 'purchase',
        date: input.date,
        partner_id: input.supplier_id,
        warehouse_id: warehouseId,
        remark: input.remark,
        items: input.items.map((it) => ({
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no,
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: it.price
        }))
      })
      const changes = input.items.map((it) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no ?? '',
          change_qty: Number(it.qty) * rate,
          unit_cost: Number(it.price ?? 0) / rate,
          source: 'purchase',
          source_id: doc?.id ?? 0
        }
      })
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  function getDetail(id: number): PurchaseDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'purchase') {
      throw new BizError('NOT_FOUND', `采购单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: PurchaseQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'purchase',
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      page: q.page,
      pageSize: q.pageSize
    }
    return docService.query(inner)
  }

  return { create, getDetail, query }
}

export type PurchaseService = ReturnType<typeof createPurchaseService>
