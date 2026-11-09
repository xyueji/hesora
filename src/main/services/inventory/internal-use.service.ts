import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { InventoryChange, InventoryRow, TrackingItemInput } from '../../../shared/types/inventory'

export type DB = Database

export interface InternalUseDetail {
  doc: DocRow
  items: DocItemRow[]
}

export interface InternalUseItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  /** 领用人（记入明细 remark 前缀） */
  receiver?: string
  /** 用途（记入明细 remark） */
  purpose?: string
}

export interface InternalUseCreateInput {
  warehouse_id: number
  date?: string
  /** 整单备注 */
  remark?: string
  operator?: string
  items: InternalUseItemInput[]
}

export interface InternalUseQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}

interface ProductRow {
  id: number
  tracking_type: string
}

/**
 * 内部领用出库单（P3）：doc type='internal_use'（编号 NLyyyyMMddNNNN），直过账。
 * 仅出库减库存，成本按移动加权（OUT 分支自动取 moving_cost）；不涉及资金与客商，
 * 可整单红冲（reversal.service 库存回退分支天然支持）。领用人/用途记入 doc_item.remark。
 */
export function createInternalUseService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const selectProduct = db.prepare('SELECT id, tracking_type FROM product WHERE id = ?')
  const selectWh = db.prepare('SELECT id FROM warehouse WHERE id = ?')
  const selectInv = db.prepare(
    'SELECT id, qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )

  /** 明细 remark：领用人/用途（doc_item.remark 现有单型未使用，此处约定格式「领用人:xxx 用途:xxx」） */
  function itemRemark(receiver?: string, purpose?: string): string {
    const parts: string[] = []
    const rcv = (receiver ?? '').trim()
    const pps = (purpose ?? '').trim()
    if (rcv) parts.push(`领用人:${rcv}`)
    if (pps) parts.push(`用途:${pps}`)
    return parts.join(' ')
  }

  function create(input: InternalUseCreateInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) throw new BizError('VALIDATION', '领用仓库不能为空')
    if (!selectWh.get(warehouseId)) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '领用明细不能为空')
    }
    for (const it of input.items) {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        throw new BizError('VALIDATION', '明细数量必须大于0')
      }
      const p = selectProduct.get(Number(it.product_id)) as ProductRow | undefined
      if (!p) throw new BizError('NOT_FOUND', `商品不存在：${it.product_id}`)
      if (p.tracking_type === 'batch' && !((it.batch_no ?? '').trim())) {
        throw new BizError('VALIDATION', '批次管理商品必须填写批次号')
      }
    }

    let doc: DocRow | undefined
    db.transaction(() => {
      // 事务内先校验可用量（成本由库存引擎 OUT 分支按 moving_cost 落账）
      for (const it of input.items) {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const need = Number(it.qty) * rate
        const row = selectInv.get(
          Number(it.product_id),
          warehouseId,
          (it.batch_no ?? '').trim()
        ) as Pick<InventoryRow, 'qty' | 'moving_cost'> | undefined
        if (!row || row.qty < need) {
          throw new BizError('NOT_ENOUGH', '库存不足')
        }
      }

      doc = docService.create({
        type: 'internal_use',
        date: input.date,
        warehouse_id: warehouseId,
        remark: input.remark,
        operator: input.operator,
        items: input.items.map((it: InternalUseItemInput) => ({
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: 0,
          commission_rate: 0
        }))
      })
      const sourceId = doc.id
      const docItems = docService.getItems(sourceId)
      const outs: InventoryChange[] = input.items.map((it, i) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: -(Number(it.qty) * rate),
          source: 'internal_use',
          source_id: sourceId,
          doc_item_id: docItems[i]?.id,
          serial_numbers: it.serial_numbers
        }
      })
      // 单次 applyChanges（自带事务/savepoint）：OUT 失败整体回滚
      inventoryService.applyChanges(outs)
      // 领用人/用途写入 doc_item.remark（doc.service.create 无此入参，落库在单据创建后）
      const updateItemRemark = db.prepare('UPDATE doc_item SET remark = ? WHERE id = ?')
      input.items.forEach((it, i) => {
        const remark = itemRemark(it.receiver, it.purpose)
        if (remark && docItems[i]?.id) updateItemRemark.run(remark, docItems[i]!.id)
      })
    })()
    return doc as DocRow
  }

  function getDetail(id: number): InternalUseDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== 'internal_use') {
      throw new BizError('NOT_FOUND', `内部领用单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: InternalUseQuery): DocPageResult {
    const inner: DocQuery = {
      type: 'internal_use',
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

export type InternalUseService = ReturnType<typeof createInternalUseService>
