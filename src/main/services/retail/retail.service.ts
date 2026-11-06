import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { RetailCreateInput, RetailItemInput, RetailQuery } from '../../../shared/types/retail'

export type DB = Database

export interface RetailDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 零售单（POS 快速开单）：单据（doc/doc_item，type='retail'，编号 LSyyyyMMddNNNN）+ 出库。
 * partner_id 可空 = 散客；account_id 可选，指定收款账户（必须存在于 fund_account）。
 * rate 语义与销售单一致：1 个录入单位 = rate 个基本单位；出库 change_qty = -(qty*rate)。
 * 仅记录单据与库存，资金流水由后续任务（fund_flow）补充。
 */
export function createRetailService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)

  function create(input: RetailCreateInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.account_id !== undefined && input.account_id !== null) {
      const acc = db.prepare('SELECT id FROM fund_account WHERE id = ?').get(Number(input.account_id))
      if (!acc) throw new BizError('NOT_FOUND', `账户不存在：${input.account_id}`)
    }
    if (input.customer_id !== undefined && input.customer_id !== null) {
      const cus = db.prepare('SELECT id FROM customer WHERE id = ?').get(Number(input.customer_id))
      if (!cus) throw new BizError('NOT_FOUND', `客户不存在：${input.customer_id}`)
    }
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '零售明细不能为空')
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
        type: 'retail',
        date: input.date,
        partner_id: input.customer_id ?? undefined,
        account_id: input.account_id ?? undefined,
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
      const changes = input.items.map((it: RetailItemInput) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no ?? '',
          change_qty: -(Number(it.qty) * rate),
          unit_cost: 0,
          source: 'retail',
          source_id: doc?.id ?? 0
        }
      })
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  function getDetail(id: number): RetailDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'retail') {
      throw new BizError('NOT_FOUND', `零售单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: RetailQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'retail',
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

export type RetailService = ReturnType<typeof createRetailService>
