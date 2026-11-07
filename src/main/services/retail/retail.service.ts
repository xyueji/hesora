import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { RetailCreateInput, RetailHeldCart, RetailItemInput, RetailQuery } from '../../../shared/types/retail'

export type DB = Database

export interface RetailDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 零售单（POS 快速开单）：单据（doc/doc_item，type='retail'，编号 LSyyyyMMddNNNN）+ 出库。
 * partner_id 可空 = 散客；account_id 可选，指定收款账户（必须存在于 fund_account）。
 * rate 语义与销售单一致：1 个录入单位 = rate 个基本单位；出库 change_qty = -(qty*rate)。
 * 仅记录单据与库存；指定 account_id 时同时写入资金流水 fund_flow（direction 'in'，doc_type 'retail'）。
 */
export function createRetailService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)

  function validate(input: RetailCreateInput): number {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.account_id !== undefined && input.account_id !== null) {
      const acc = db.prepare('SELECT id FROM fund_account WHERE id = ? AND disabled = 0').get(Number(input.account_id))
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
      const rate = Number(it.rate ?? 1)
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new BizError('VALIDATION', '明细单位换算率无效')
      }
    }
    return warehouseId
  }

  function assertOperator(operatorId: number): void {
    if (!db.prepare('SELECT id FROM "user" WHERE id = ? AND disabled = 0').get(operatorId)) {
      throw new BizError('NOT_FOUND', '操作员不存在或已停用')
    }
  }

  function hold(operatorId: number, input: RetailCreateInput): number {
    assertOperator(operatorId)
    const warehouseId = validate(input)
    const { held_id: id, ...cart } = input
    const payload = JSON.stringify({ ...cart, warehouse_id: warehouseId })
    if (id === undefined) {
      return Number(db.prepare(
        'INSERT INTO retail_held (operator_id, payload) VALUES (?, ?)'
      ).run(operatorId, payload).lastInsertRowid)
    }
    const updated = db.prepare(
      "UPDATE retail_held SET payload = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND operator_id = ?"
    ).run(payload, id, operatorId)
    if (updated.changes === 0) throw new BizError('NOT_FOUND', '挂单不存在或已结算')
    return id
  }

  function listHeld(operatorId: number): RetailHeldCart[] {
    assertOperator(operatorId)
    const rows = db.prepare(
      'SELECT id, payload, updated_at FROM retail_held WHERE operator_id = ? ORDER BY updated_at DESC, id DESC'
    ).all(operatorId) as Array<{ id: number; payload: string; updated_at: string }>
    return rows.map(({ id, payload, updated_at }) => ({
      id,
      updated_at,
      input: JSON.parse(payload) as RetailHeldCart['input']
    }))
  }

  function discardHeld(operatorId: number, id: number): void {
    assertOperator(operatorId)
    const removed = db.prepare(
      'DELETE FROM retail_held WHERE id = ? AND operator_id = ?'
    ).run(id, operatorId)
    if (removed.changes === 0) throw new BizError('NOT_FOUND', '挂单不存在或已结算')
  }

  function create(input: RetailCreateInput, operatorId?: number): DocRow {
    let doc: DocRow | undefined
    db.transaction(() => {
      const warehouseId = validate(input)
      if (input.held_id !== undefined) {
        if (operatorId === undefined) throw new BizError('VALIDATION', '结算挂单需要登录')
        discardHeld(operatorId, input.held_id)
      }
      doc = docService.create({
        type: 'retail',
        operator: input.operator,
        date: input.date,
        partner_id: input.customer_id ?? undefined,
        account_id: input.account_id ?? undefined,
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
      const changes = input.items.map((it: RetailItemInput, index) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: -(Number(it.qty) * rate),
          unit_cost: 0,
          source: 'retail',
          source_id: doc?.id ?? 0,
          doc_item_id: docItems[index]?.id,
          date: doc?.date,
          serial_numbers: it.serial_numbers,
          production_date: it.production_date,
          expire_date: it.expire_date
        }
      })
      inventoryService.applyChanges(changes)
      // 指定收款账户时记录资金流水（零售收款，流入）。
      if (input.account_id !== undefined && input.account_id !== null) {
        db.prepare(
          `INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
           VALUES (?, 'retail', ?, ?, 'in', ?, ?)`
        ).run(
          Number(input.account_id),
          doc?.id ?? 0,
          doc?.total_amount ?? 0,
          doc?.date ?? '',
          input.remark ?? null
        )
      }
    }).immediate()
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

  return { create, getDetail, query, hold, listHeld, discardHeld }
}

export type RetailService = ReturnType<typeof createRetailService>
