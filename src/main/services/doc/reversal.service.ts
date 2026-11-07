import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { DOC_NO_PREFIX } from '../../../shared/types/doc'
import type { DocItemRow, DocRow, DocType } from '../../../shared/types/doc'
import { createInventoryService } from '../inventory/inventory.service'
import type { InventoryChange } from '../../../shared/types/inventory'

export type DB = Database

/**
 * 已过账单据红冲（负向镜像单）服务。
 *
 * 模型：为已过账（status='done'）单据生成一张全额负向镜像单（type 相同、
 * 数量/金额取负、remark "红冲 <原单号>"、reversal_of 指向原单），并按原单
 * cost_log 逐条取反回退库存：
 *  - 原出库（change_qty<0）→ 红冲入库：unit_cost 取原出库时点记录的 moving_cost
 *    （cost_log.unit_cost 即出库时点的移动加权成本），比"当前 moving_cost"更精确；
 *  - 原入库（change_qty>0）→ 红冲出库：按当前结存 moving_cost 扣减（引擎语义）。
 * 资金单据（receipt/payment/other_in/other_out）：生成反向 fund_flow（direction 取反）
 * + 负向 doc；原单若有 payment_allocation 核销行则直接删除（选择简单口径，
 * 不做按比例冲减——红冲为全额冲销，原核销关系整体作废）。
 * 序列号：原单 serial_flow 逐条反向（原 in → 核销 out；原 out → 重新入库）。
 */
export function createReversalService(db: DB) {
  const inventoryService = createInventoryService(db)

  const FUND_TYPES: readonly DocType[] = ['receipt', 'payment', 'other_in', 'other_out']

  interface ReversalDocDbRow {
    id: number
    no: string
    type: string
    date: string
    status: string
    reversal_of: number | null
  }

  function getDocRow(id: number): ReversalDocDbRow | null {
    return (db.prepare('SELECT id, no, type, date, status, reversal_of FROM doc WHERE id = ?').get(id) ??
      null) as ReversalDocDbRow | null
  }

  function todayLocal(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function nextNo(type: DocType, date: string): string {
    const compact = date.replace(/-/g, '')
    const prefix = `${DOC_NO_PREFIX[type]}${compact}`
    const { last } = db
      .prepare('SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS last FROM doc WHERE type = ? AND date = ?')
      .get(prefix.length + 1, type, date) as { last: number | null }
    return `${prefix}${String((last ?? 0) + 1).padStart(4, '0')}`
  }

  interface CostLogEntry {
    product_id: number
    warehouse_id: number
    batch_no: string
    change_qty: number
    unit_cost: number
    source: string | null
  }

  /** 红冲明细行（负向镜像 doc_item）。 */
  function mirrorItems(items: DocItemRow[]): DocItemRow[] {
    return items.map((it) => ({
      ...it,
      qty: -it.qty,
      amount: -it.amount
    }))
  }

  /** 按原单 cost_log 逐条取反生成库存回退 changes；序列号商品须带 serial_numbers（一件一码）。 */
  function reversalChanges(sourceDocId: number, reversalId: number): InventoryChange[] {
    const logs = db
      .prepare(
        `SELECT product_id, warehouse_id, batch_no, change_qty, unit_cost, source
         FROM cost_log WHERE source_id = ? AND source <> 'reversal' ORDER BY id`
      )
      .all(sourceDocId) as CostLogEntry[]
    // cost_log 无 doc_item 关联列：按 (product, warehouse, batch) 与原单明细逐一配对，映射到红冲明细行 id
    const itemBuckets = new Map<string, number[]>()
    for (const it of db
      .prepare('SELECT id, product_id, warehouse_id, batch_no FROM doc_item WHERE doc_id = ? ORDER BY id')
      .all(sourceDocId) as { id: number; product_id: number; warehouse_id: number; batch_no: string }[]) {
      const key = `${it.product_id}:${it.warehouse_id}:${it.batch_no}`
      itemBuckets.set(key, [...(itemBuckets.get(key) ?? []), it.id])
    }
    return logs.map((log) => {
      const key = `${log.product_id}:${log.warehouse_id}:${log.batch_no}`
      const bucket = itemBuckets.get(key)
      const docItemId = bucket?.shift()
      if (log.change_qty < 0) {
        // 原出库 → 红冲入库，按出库时点的移动加权成本记回
        return {
          product_id: log.product_id,
          warehouse_id: log.warehouse_id,
          batch_no: log.batch_no,
          change_qty: -log.change_qty,
          unit_cost: log.unit_cost,
          source: 'reversal',
          source_id: reversalId,
          source_doc_id: sourceDocId,
          doc_item_id: docItemId
        }
      }
      // 原入库 → 红冲出库，引擎按当前 moving_cost 扣
      return {
        product_id: log.product_id,
        warehouse_id: log.warehouse_id,
        batch_no: log.batch_no,
        change_qty: -log.change_qty,
        source: 'reversal',
        source_id: reversalId,
        source_doc_id: sourceDocId,
        doc_item_id: docItemId
      }
    })
  }

  /** 原单每条 serial_flow 的 sn（按原 doc_item 分组），供反向库存变动带一件一码。 */
  function serialsOfDoc(originalId: number): Map<number, string[]> {
    const flows = db
      .prepare('SELECT doc_item_id, sn FROM serial_flow WHERE doc_id = ? ORDER BY id')
      .all(originalId) as { doc_item_id: number | null; sn: string }[]
    const map = new Map<number, string[]>()
    for (const flow of flows) {
      if (flow.doc_item_id === null) continue
      const list = map.get(flow.doc_item_id) ?? []
      list.push(flow.sn)
      map.set(flow.doc_item_id, list)
    }
    return map
  }

  /** 序列号反向：原单每条 serial_flow 取反（原 in → out；原 out → in）。 */
  function reverseSerialFlows(originalId: number, reversalDocId: number, itemMap: Map<number, number>): void {
    const flows = db
      .prepare('SELECT sn, product_id, doc_item_id, direction FROM serial_flow WHERE doc_id = ? ORDER BY id')
      .all(originalId) as { sn: string; product_id: number; doc_item_id: number | null; direction: string }[]
    for (const flow of flows) {
      const row = db
        .prepare('SELECT id, status FROM serial_number WHERE sn = ? AND product_id = ?')
        .get(flow.sn, flow.product_id) as { id: number; status: string } | undefined
      if (!row) throw new BizError('VALIDATION', `序列号台账缺失：${flow.sn}`)
      // 反向库存变动已把原 in 的 SN 标记为 out（status='out'）——这里只处理原 out 的红冲回库，
      // 原方向已是 out 的 SN 表示红冲后重新入库（无需再改台账，仅写反向流水）。
      if (flow.direction === 'out') {
        db.prepare(
          `UPDATE serial_number SET status = 'in_stock', out_qty = 0,
             out_date = NULL, out_source = NULL, out_source_id = NULL WHERE id = ?`
        ).run(row.id)
      }
      db.prepare(
        `INSERT INTO serial_flow (sn, product_id, doc_id, doc_item_id, direction, qty, created_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'))`
      ).run(
        flow.sn,
        flow.product_id,
        reversalDocId,
        flow.doc_item_id !== null ? itemMap.get(flow.doc_item_id) ?? null : null,
        flow.direction === 'in' ? 'out' : 'in'
      )
    }
  }

  /**
   * 红冲一张已过账单据，返回红冲镜像单。
   * 仅 status='done' 可冲；一张原单最多一张红冲单（部分唯一索引兜底）。
   */
  function reverse(docId: number, operator?: string): DocRow {
    const id = Number(docId)
    if (!Number.isInteger(id) || id <= 0) throw new BizError('VALIDATION', '单据ID无效')
    const source = getDocRow(id)
    if (!source) throw new BizError('NOT_FOUND', `单据不存在：${id}`)
    if (source.status !== 'done') {
      throw new BizError('VALIDATION', '只有已过账单据可以红冲')
    }
    if (source.reversal_of !== null) {
      throw new BizError('VALIDATION', `该单据已被红冲过：${source.no}`)
    }
    const existing = db
      .prepare('SELECT id FROM doc WHERE reversal_of = ?')
      .get(id) as { id: number } | undefined
    if (existing) {
      throw new BizError('VALIDATION', `该单据已被红冲过：${source.no}`)
    }
    const type = source.type as DocType
    const originalItemRows = db
      .prepare('SELECT * FROM doc_item WHERE doc_id = ? ORDER BY id')
      .all(id) as DocItemRow[]
    const items = mirrorItems(originalItemRows)
    const isFund = FUND_TYPES.includes(type)
    if (!isFund && items.length === 0) {
      throw new BizError('VALIDATION', '原单没有明细，无法红冲')
    }
    const totalAmount = isFund
      ? -(db.prepare('SELECT total_amount FROM doc WHERE id = ?').get(id) as { total_amount: number }).total_amount
      : items.reduce((sum, it) => sum + it.amount, 0)

    let reversalId = 0
    db.transaction(() => {
      const date = todayLocal()
      const no = nextNo(type, date)
      const sourceRow = db
        .prepare('SELECT partner_id, warehouse_id, warehouse_in_id, account_id, operator FROM doc WHERE id = ?')
        .get(id) as {
        partner_id: number | null
        warehouse_id: number | null
        warehouse_in_id: number | null
        account_id: number | null
        operator: string | null
      }
      reversalId = Number(
        db
          .prepare(
            `INSERT INTO doc (no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark, source_doc_id, operator, status, reversal_of)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`
          )
          .run(
            no,
            type,
            date,
            sourceRow.partner_id,
            sourceRow.warehouse_id,
            sourceRow.warehouse_in_id,
            sourceRow.account_id,
            totalAmount,
            `红冲 ${source.no}`,
            id,
            operator?.trim() ? operator.trim() : sourceRow.operator,
            id
          ).lastInsertRowid
      )
      // 明细负向镜像（doc_item_id 映射红冲行 id，供 serial_flow 关联）
      const insertItem = db.prepare(
        `INSERT INTO doc_item (doc_id, product_id, warehouse_id, batch_no, unit, rate, qty, price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const itemMap = new Map<number, number>()
      const originalItems = db
        .prepare('SELECT id, product_id, warehouse_id, batch_no, unit, rate, qty, price, amount FROM doc_item WHERE doc_id = ? ORDER BY id')
        .all(id) as DocItemRow[]
      originalItems.forEach((orig) => {
        const newId = Number(
          insertItem.run(
            reversalId,
            orig.product_id,
            orig.warehouse_id,
            orig.batch_no,
            orig.unit,
            orig.rate,
            -orig.qty,
            orig.price,
            -orig.amount
          ).lastInsertRowid
        )
        itemMap.set(orig.id, newId)
      })
      // 库存回退（资金单据无库存）；序列号商品按原 serial_flow 逐条反向，一件一码
      if (!isFund) {
        const serialMap = serialsOfDoc(id)
        const changes = reversalChanges(id, reversalId).map((change) => {
          const sns = serialMap.get(change.doc_item_id ?? -1)
          return sns ? { ...change, serial_numbers: sns } : change
        })
        if (changes.length > 0) inventoryService.applyChanges(changes)
      }
      // 序列号反向
      if (!isFund) reverseSerialFlows(id, reversalId, itemMap)
      // 资金单据：反向 fund_flow + 删除核销行
      if (isFund) {
        const flows = db
          .prepare('SELECT account_id, amount, direction, date, remark FROM fund_flow WHERE doc_id = ?')
          .all(id) as { account_id: number; amount: number; direction: string; date: string; remark: string | null }[]
        const insertFlow = db.prepare(
          `INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        for (const flow of flows) {
          insertFlow.run(
            flow.account_id,
            type,
            reversalId,
            flow.amount,
            flow.direction === 'in' ? 'out' : 'in',
            date,
            `红冲 ${source.no}`
          )
        }
        db.prepare('DELETE FROM payment_allocation WHERE payment_id = ?').run(id)
      }
    }).immediate()
    const doc = db
      .prepare('SELECT * FROM doc WHERE id = ?')
      .get(reversalId) as DocRow | undefined
    if (!doc) throw new BizError('INTERNAL', '红冲单创建失败')
    return doc
  }

  /** 查某单的红冲单（0 或 1 张）。 */
  function listReversals(docId: number): DocRow[] {
    const id = Number(docId)
    if (!Number.isInteger(id) || id <= 0) return []
    const rows = db
      .prepare(
        `SELECT d.*, COALESCE(NULLIF(c.name, ''), NULLIF(s.name, '')) AS partner_name
         FROM doc d
         LEFT JOIN customer c ON c.id = d.partner_id AND d.type IN ('sale','sale_return','retail','receipt')
         LEFT JOIN supplier s ON s.id = d.partner_id AND d.type IN ('purchase','purchase_return','payment')
         WHERE d.reversal_of = ? ORDER BY d.id`
      )
      .all(id) as DocRow[]
    return rows
  }

  return { reverse, listReversals }
}

export type ReversalService = ReturnType<typeof createReversalService>
