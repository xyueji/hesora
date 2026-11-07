import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { InventoryChange, InventoryRow } from '../../../shared/types/inventory'
import type { TransferCreateInput, TransferItemInput, TransferQuery } from '../../../shared/types/transfer'

export type DB = Database

export interface TransferDetail {
  doc: DocRow
  items: DocItemRow[]
}

interface ProductRow {
  id: number
  tracking_type: string
}

/**
 * 调拨单：仓库间库存转移。doc（type='transfer'，编号 DByyyyMMddNNNN）+ 同事务内
 * 一次 applyChanges（先 OUT 后 IN）。调入成本 = 调出时源仓库的 moving_cost。
 * 调拨无价格语义，单据金额为 0。
 */
export function createTransferService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const selectProduct = db.prepare('SELECT id, tracking_type FROM product WHERE id = ?')
  const selectWh = db.prepare('SELECT id FROM warehouse WHERE id = ?')
  const selectInv = db.prepare(
    'SELECT id, qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )

  function create(input: TransferCreateInput): DocRow {
    const fromId = Number(input.warehouse_id)
    const toId = Number(input.warehouse_in_id)
    if (!Number.isInteger(fromId)) throw new BizError('VALIDATION', '调出仓库不能为空')
    if (!Number.isInteger(toId)) throw new BizError('VALIDATION', '调入仓库不能为空')
    if (fromId === toId) throw new BizError('VALIDATION', '调出仓库与调入仓库不能相同')
    if (!selectWh.get(fromId)) throw new BizError('NOT_FOUND', `仓库不存在：${fromId}`)
    if (!selectWh.get(toId)) throw new BizError('NOT_FOUND', `仓库不存在：${toId}`)
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '调拨明细不能为空')
    }
    for (const it of input.items) {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        throw new BizError('VALIDATION', '明细数量必须大于0')
      }
      const p = selectProduct.get(Number(it.product_id)) as ProductRow | undefined
      if (!p) throw new BizError('NOT_FOUND', `商品不存在：${it.product_id}`)
      if (p.tracking_type === 'batch' && !((it.batch_no ?? '').trim()).trim()) {
        throw new BizError('VALIDATION', '批次管理商品必须填写批次号')
      }
    }

    let doc: DocRow | undefined
    db.transaction(() => {
      // 事务内先读源库存行：校验可用量并捕获调出时的 moving_cost（作为调入成本）
      const costs: number[] = []
      for (const it of input.items) {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const need = Number(it.qty) * rate
        const row = selectInv.get(
          Number(it.product_id),
          fromId,
          (it.batch_no ?? '').trim()
        ) as Pick<InventoryRow, 'qty' | 'moving_cost'> | undefined
        if (!row || row.qty < need) {
          throw new BizError('NOT_ENOUGH', '库存不足')
        }
        costs.push(row.moving_cost)
      }

      doc = docService.create({
        type: 'transfer',
        date: input.date,
        warehouse_id: fromId,
        warehouse_in_id: toId,
        remark: input.remark,
        items: input.items.map((it: TransferItemInput) => ({
          product_id: it.product_id,
          warehouse_id: fromId,
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: 0
        }))
      })
      const sourceId = doc.id
      const docItems = docService.getItems(sourceId)
      const outs: InventoryChange[] = []
      const ins: InventoryChange[] = []
      input.items.forEach((it, i) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const changeQty = Number(it.qty) * rate
        outs.push({
          product_id: it.product_id,
          warehouse_id: fromId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: -changeQty,
          source: 'transfer',
          source_id: sourceId,
          doc_item_id: docItems[i]?.id,
          serial_numbers: it.serial_numbers
        })
        ins.push({
          product_id: it.product_id,
          warehouse_id: toId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: changeQty,
          unit_cost: costs[i],
          from_warehouse_id: fromId,
          source: 'transfer',
          source_id: sourceId,
          doc_item_id: docItems[i]?.id,
          serial_numbers: it.serial_numbers
        })
      })
      // 单次 applyChanges（自带事务/savepoint）：OUT 失败整体回滚
      inventoryService.applyChanges([...outs, ...ins])
    })()
    return doc as DocRow
  }

  function getDetail(id: number): TransferDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'transfer') {
      throw new BizError('NOT_FOUND', `调拨单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: TransferQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'transfer',
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

export type TransferService = ReturnType<typeof createTransferService>
