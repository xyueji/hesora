import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'

import type { PurchaseCreateInput, PurchaseQuery, PurchaseReturnInput } from '../../../shared/types/purchase'
export type { PurchaseItemInput, PurchaseCreateInput, PurchaseQuery } from '../../../shared/types/purchase'

export type DB = Database

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
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: it.price
        }))
      })
      const docItems = docService.getItems(doc.id)
      const changes = input.items.map((it, index) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: Number(it.qty) * rate,
          unit_cost: Number(it.price ?? 0) / rate,
          source: 'purchase',
          source_id: doc?.id ?? 0,
          doc_item_id: docItems[index]?.id,
          date: doc?.date,
          serial_numbers: it.serial_numbers,
          production_date: it.production_date,
          expire_date: it.expire_date
        }
      })
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  /** 退货冲减往来余额。选择有效账户时，同时登记实际退款。 */
  function createReturn(input: PurchaseReturnInput): DocRow {
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
      throw new BizError('VALIDATION', '采购退货明细不能为空')
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
    const accountId = input.account_id ?? null
    let doc: DocRow | undefined
    db.transaction(() => {
      if (accountId !== null) {
        const account = db.prepare('SELECT id FROM fund_account WHERE id = ? AND disabled = 0').get(accountId)
        if (!account) throw new BizError('NOT_FOUND', '结算账户不存在或已停用')
      }
      doc = docService.create({
        type: 'purchase_return',
        date: input.date,
        partner_id: input.supplier_id,
        warehouse_id: warehouseId,
        account_id: accountId ?? undefined,
        source_doc_id: input.source_doc_id,
        remark: input.remark,
        items: input.items.map((it) => ({
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: it.price
        }))
      })
      const docItems = docService.getItems(doc.id)
      const changes = input.items.map((it, index) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: -(Number(it.qty) * rate),
          unit_cost: 0,
          source: 'purchase_return',
          source_id: doc?.id ?? 0,
          doc_item_id: docItems[index]?.id,
          date: doc?.date,
          source_doc_id: input.source_doc_id,
          serial_numbers: it.serial_numbers,
          production_date: it.production_date,
          expire_date: it.expire_date
        }
      })
      inventoryService.applyChanges(changes)
      const total = doc?.total_amount ?? 0
      if (accountId !== null && total > 0) {
        db.prepare(
          `INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
           VALUES (?, 'purchase_return', ?, ?, 'in', ?, ?)`
        ).run(
          accountId,
          doc?.id ?? 0,
          total,
          doc?.date ?? '',
          input.remark ?? null
        )
      }
    }).immediate()
    return doc as DocRow
  }

  function getDetail(id: number): PurchaseDetail {
    const doc = docService.getById(id)
    if (!doc || (doc.type !== 'purchase' && doc.type !== 'purchase_return')) {
      throw new BizError('NOT_FOUND', `采购单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: PurchaseQuery): DocPageResult {
    if (q.type !== undefined && q.type !== 'purchase' && q.type !== 'purchase_return') {
      throw new BizError('VALIDATION', '采购单据类型无效')
    }
    const inner: DocQuery = {
      types: q.type ? [q.type] : ['purchase', 'purchase_return'],
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      partner_id: q.partner_id,
      page: q.page,
      pageSize: q.pageSize
    }
    return docService.query(inner)
  }

  return { create, createReturn, getDetail, query }
}

export type PurchaseService = ReturnType<typeof createPurchaseService>
