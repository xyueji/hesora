import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'

export type DB = Database

export interface SaleItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

export interface SaleCreateInput {
  customer_id?: number
  warehouse_id: number
  date?: string
  remark?: string
  items: SaleItemInput[]
}

export interface SaleQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  page: number
  pageSize: number
}

export interface SaleDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 销售单：单据（doc/doc_item，type='sale'，编号 XSyyyyMMddNNNN）+ 出库（inventory/cost_log），
 * 二者写在一个事务里，保证单据与库存原子一致（库存不足时单据一并回滚）。
 * rate 语义：1 个录入单位 = rate 个基本单位；出库 change_qty = -(qty*rate)，
 * OUT 不写 unit_cost（成本引擎按移动加权计算）。
 */
export function createSaleService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)

  function create(input: SaleCreateInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.customer_id !== undefined && input.customer_id !== null) {
      const cus = db.prepare('SELECT id FROM customer WHERE id = ?').get(Number(input.customer_id))
      if (!cus) throw new BizError('NOT_FOUND', `客户不存在：${input.customer_id}`)
    }
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '销售明细不能为空')
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
        type: 'sale',
        date: input.date,
        partner_id: input.customer_id,
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
          change_qty: -(Number(it.qty) * rate),
          unit_cost: 0,
          source: 'sale',
          source_id: doc?.id ?? 0
        }
      })
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  function getDetail(id: number): SaleDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'sale') {
      throw new BizError('NOT_FOUND', `销售单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: SaleQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'sale',
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      partner_id: q.partner_id,
      page: q.page,
      pageSize: q.pageSize
    }
    return docService.query(inner)
  }

  return { create, getDetail, query }
}

export type SaleService = ReturnType<typeof createSaleService>
