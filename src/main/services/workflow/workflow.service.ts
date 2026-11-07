import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { WORKFLOW_CONVERSIONS, WORKFLOW_KINDS, type FulfillmentRequest, type OrderFulfillment, type WorkflowInput, type WorkflowItem, type WorkflowKind, type WorkflowRow } from '../../../shared/types/workflow'
import { createPurchaseService } from '../purchase/purchase.service'
import { createSaleService } from '../sale/sale.service'

type StoredRow = Pick<WorkflowRow, 'id' | 'status' | 'kind' | 'source_id' | 'source_kind' | 'posted_doc_id' | 'posted_doc_no' | 'converted_id' | 'approved_by'> & { body: string }
type Event = 'created' | 'edited' | 'approved' | 'cancelled' | 'converted'

const isOrder = (kind: WorkflowKind) => kind === 'sale_order' || kind === 'purchase_order'
const quantity = (value: number) => Number(value.toFixed(8))
const today = () => new Date().toLocaleDateString('sv-SE')

function toRow(stored: StoredRow): WorkflowRow {
  const { body, ...metadata } = stored
  return { ...JSON.parse(body) as WorkflowInput, ...metadata }
}

export function createWorkflowService(db: Database) {
  const sale = createSaleService(db)
  const purchase = createPurchaseService(db)
  const select = `SELECT w.*, d.no AS posted_doc_no, parent.kind AS source_kind,
    (SELECT MIN(next.id) FROM doc_workflow next WHERE next.source_id = w.id AND next.status <> 'cancelled') AS converted_id
    FROM doc_workflow w LEFT JOIN doc d ON d.id = w.posted_doc_id
    LEFT JOIN doc_workflow parent ON parent.id = w.source_id`
  const insert = db.prepare('INSERT INTO doc_workflow (kind, body, source_id) VALUES (?, ?, ?)')
  const event = db.prepare('INSERT INTO doc_workflow_event (workflow_id, action, operator_id) VALUES (?, ?, ?)')
  const log = (id: number, action: Event, actor: number) => event.run(id, action, actor)

  function read(id: number): WorkflowRow {
    const row = db.prepare(`${select} WHERE w.id = ?`).get(id) as StoredRow | undefined
    if (!row) throw new BizError('NOT_FOUND', '单据不存在')
    return toRow(row)
  }

  // doc.reversal_of（迁移026）在旧版本库中可能不存在，按实际 schema 决定是否排除已红冲批次。
  const hasReversalColumn = !!db.prepare(
    "SELECT 1 FROM pragma_table_info('doc') WHERE name = 'reversal_of'"
  ).get()
  const reversedExpr = hasReversalColumn
    ? '(SELECT 1 FROM doc r WHERE r.reversal_of = d.id) AS reversed'
    : 'NULL AS reversed'
  function fulfillment(order: WorkflowRow, excludeId = 0): OrderFulfillment {
    const lines = order.items.map((item, line) => ({ ...item, line, posted: 0, reserved: 0, remaining: item.qty }))
    const children = db.prepare(`SELECT w.id, w.body, w.status, d.no AS postedNo, w.posted_doc_id,
      ${reversedExpr}
      FROM doc_workflow w
      LEFT JOIN doc d ON d.id = w.posted_doc_id WHERE w.source_id = ? AND w.id <> ? ORDER BY w.id`)
      .all(order.id, excludeId) as { id: number; body: string; status: WorkflowRow['status']; postedNo: string | null; posted_doc_id: number | null; reversed: number | null }[]
    const batches: OrderFulfillment['batches'] = []
    let legacy = false
    for (const child of children) {
      const body = JSON.parse(child.body) as WorkflowInput
      batches.push({ id: child.id, date: body.date, status: child.status, postedNo: child.postedNo })
      // 已过账但被红冲的 child：其履行贡献已随红冲回退，posted 不再计入；
      // 但批次仍展示（保留状态），保持可追溯。
      if (child.status === 'cancelled') continue
      const postedReversed = child.status === 'approved' && child.posted_doc_id !== null && child.reversed === 1
      if (postedReversed) continue
      for (const item of body.items) {
        const line = item.source_line === undefined ? undefined : lines[item.source_line]
        if (!line) {
          legacy = true
          continue
        }
        if (child.status === 'approved') line.posted = quantity(line.posted + item.qty)
        else line.reserved = quantity(line.reserved + item.qty)
      }
    }
    for (const line of lines) line.remaining = legacy ? 0 : Math.max(0, quantity(line.qty - line.posted - line.reserved))
    const state = legacy ? 'legacy'
      : lines.every((line) => quantity(line.qty - line.posted) <= 0) ? 'completed'
      : lines.some((line) => line.posted > 0) ? 'partial'
      : lines.some((line) => line.reserved > 0) ? 'reserved' : 'pending'
    return { state, lines, batches }
  }

  function withFulfillment(row: WorkflowRow): WorkflowRow {
    return isOrder(row.kind) ? { ...row, fulfillment: fulfillment(row) } : row
  }

  function get(id: number): WorkflowRow {
    return withFulfillment(read(id))
  }

  function linkedOrder(child: WorkflowRow): WorkflowRow | undefined {
    if (child.source_id === null) return undefined
    const parent = read(child.source_id)
    return isOrder(parent.kind) ? parent : undefined
  }

  function validateLinked(input: WorkflowInput, child: WorkflowRow): void {
    const order = linkedOrder(child)
    if (!order) return
    if (order.warehouse_id !== input.warehouse_id || (order.partner_id ?? null) !== (input.partner_id ?? null) || input.date < order.date) {
      throw new BizError('VALIDATION', '分批单据必须沿用订单仓库和往来单位，业务日期不能早于订单')
    }
    // Historical one-shot children lack line identities. Their existing terms remain intact.
    if (child.items.some((item) => item.source_line === undefined)) {
      if (JSON.stringify(child.items) !== JSON.stringify(input.items)) {
        throw new BizError('VALIDATION', '历史转单未记录订单行，取消草稿后可重新分批')
      }
      return
    }
    const available = fulfillment(order, child.id)
    const used = new Set<number>()
    for (const item of input.items) {
      const index = item.source_line
      const original = index === undefined ? undefined : available.lines[index]
      if (index === undefined || !Number.isInteger(index) || !original || used.has(index) ||
          item.product_id !== original.product_id || (item.unit ?? '') !== (original.unit ?? '') ||
          (item.rate ?? 1) !== (original.rate ?? 1) || item.price !== original.price ||
          (original.batch_no && item.batch_no !== original.batch_no)) {
        throw new BizError('VALIDATION', '分批明细必须沿用订单行的商品、单位、单价和指定批次')
      }
      if (quantity(item.qty) !== item.qty || item.qty <= 0 || item.qty > original.remaining) {
        throw new BizError('VALIDATION', '本次履行数量超过订单行剩余数量，或数量无效')
      }
      used.add(index)
    }
  }

  function fulfillmentItems(order: WorkflowRow, request?: FulfillmentRequest[]): WorkflowItem[] {
    const available = fulfillment(order)
    if (available.state === 'legacy' || available.state === 'completed' || !available.lines.some((line) => line.remaining > 0)) {
      throw new BizError('DOC_DONE', '该订单已转单，当前没有可转的剩余数量')
    }
    const selection = request ?? available.lines.filter((line) => line.remaining > 0).map((line) => ({ line: line.line, qty: line.remaining }))
    if (!Array.isArray(selection) || !selection.length) throw new BizError('VALIDATION', '请填写本次履行数量')
    const seen = new Set<number>()
    return selection.map((entry) => {
      const original = available.lines[entry?.line]
      const qty = entry?.qty
      if (!original || !Number.isInteger(entry.line) || seen.has(entry.line) || !Number.isFinite(qty) || quantity(qty) !== qty || qty <= 0 || qty > original.remaining) {
        throw new BizError('VALIDATION', '订单行重复、数量无效或超过剩余可转数量')
      }
      seen.add(entry.line)
      return { ...order.items[entry.line]!, qty: quantity(qty), source_line: entry.line }
    })
  }

  function validate(input: WorkflowInput): void {
    if (!input || !WORKFLOW_KINDS.includes(input.kind)) throw new BizError('VALIDATION', '单据类型无效')
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(`${input.date}T00:00:00Z`) : null
    if (!date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== input.date) {
      throw new BizError('VALIDATION', '请选择有效的单据日期')
    }
    if (!db.prepare('SELECT 1 FROM warehouse WHERE id = ? AND disabled = 0').get(input.warehouse_id)) {
      throw new BizError('VALIDATION', '请选择启用的仓库')
    }
    if (!Array.isArray(input.items) || !input.items.length) throw new BizError('VALIDATION', '请录入商品明细')
    const product = db.prepare('SELECT 1 FROM product WHERE id = ? AND disabled = 0')
    for (const item of input.items) {
      if (!item || !Number.isSafeInteger(item.product_id) || !product.get(item.product_id)) throw new BizError('VALIDATION', '明细包含不存在或停用的商品')
      const rate = item.rate ?? 1
      if (!Number.isFinite(item.qty) || !Number.isFinite(rate) || !Number.isFinite(item.qty * rate) || item.qty <= 0 || rate <= 0 ||
          !Number.isFinite(item.price) || item.price < 0 || !Number.isFinite(item.qty * item.price) || (isOrder(input.kind) && quantity(item.qty) !== item.qty)) {
        throw new BizError('VALIDATION', '请检查商品明细的数量、单位和单价')
      }
    }
    if (input.partner_id != null) {
      const table = input.kind === 'purchase_order' || input.kind === 'purchase' ? 'supplier' : 'customer'
      if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND disabled = 0`).get(input.partner_id)) {
        throw new BizError('VALIDATION', '请选择启用的往来单位')
      }
    }
  }

  function bodyOf({ warehouse_id, partner_id, date, remark, items }: WorkflowInput): string {
    return JSON.stringify({ warehouse_id, partner_id, date, remark, items })
  }

  function draft(id: number): WorkflowRow {
    const row = get(id)
    if (row.status !== 'draft') throw new BizError('DOC_DONE', '此操作只适用于草稿')
    return row
  }

  return {
    get,
    list(page = 1, kind?: WorkflowKind, allowed: readonly WorkflowKind[] = WORKFLOW_KINDS): { list: WorkflowRow[]; total: number } {
      const params = kind ? allowed.filter((item) => item === kind) : [...allowed]
      if (!params.length) return { list: [], total: 0 }
      const filter = `WHERE w.kind IN (${params.map(() => '?').join(',')})`
      const offset = Math.max(0, (Math.max(1, Math.floor(page) || 1) - 1) * 30)
      const list = db.prepare(`${select} ${filter} ORDER BY w.id DESC LIMIT 30 OFFSET ?`).all(...params, offset) as StoredRow[]
      const total = db.prepare(`SELECT COUNT(*) FROM doc_workflow w ${filter}`).pluck().get(...params) as number
      return { list: list.map((row) => withFulfillment(toRow(row))), total }
    },
    save(input: WorkflowInput, actor: number): WorkflowRow {
      return db.transaction(() => {
        validate(input)
        if (input.id !== undefined) {
          const row = draft(input.id)
          if (row.kind !== input.kind) throw new BizError('VALIDATION', '保存后不能更改单据类型')
          validateLinked(input, row)
          db.prepare('UPDATE doc_workflow SET body = ? WHERE id = ?').run(bodyOf(input), row.id)
          log(row.id, 'edited', actor)
          return get(row.id)
        }
        const items = input.items.map(({ source_line: _source, ...item }) => item)
        const id = Number(insert.run(input.kind, bodyOf({ ...input, items }), null).lastInsertRowid)
        log(id, 'created', actor)
        return get(id)
      }).immediate()
    },
    approve(id: number, actor: number): WorkflowRow {
      return db.transaction(() => {
        const row = draft(id)
        validate(row)
        validateLinked(row, row)
        const posted = row.kind === 'purchase'
          ? purchase.create({ ...row, supplier_id: row.partner_id })
          : row.kind === 'sale' ? sale.create({ ...row, customer_id: row.partner_id }) : null
        db.prepare("UPDATE doc_workflow SET status = 'approved', posted_doc_id = ?, approved_by = ? WHERE id = ?")
          .run(posted?.id ?? null, actor, id)
        log(id, 'approved', actor)
        return get(id)
      }).immediate()
    },
    convert(id: number, actor: number, target?: WorkflowKind, request?: FulfillmentRequest[]): WorkflowRow {
      return db.transaction(() => {
        const row = get(id)
        const targets = WORKFLOW_CONVERSIONS[row.kind]
        const next = target ?? targets?.[0]
        if (row.status === 'draft') throw new BizError('VALIDATION', '单据需先审核通过才能转单')
        if (row.status !== 'approved') throw new BizError('VALIDATION', '已作废的单据不能转单')
        if (!next || !targets?.includes(next)) {
          throw new BizError('VALIDATION', '当前单据不支持该类型的转单')
        }
        if (!isOrder(row.kind) && row.converted_id !== null) throw new BizError('DOC_DONE', '该单据已转单')
        if (!isOrder(row.kind) && request !== undefined) throw new BizError('VALIDATION', '只有采购或销售订单支持分批')
        const order = isOrder(row.kind)
        const items = order ? fulfillmentItems(row, request) : row.items
        const currentDate = today()
        const date = order && currentDate > row.date ? currentDate : row.date
        const child = Number(insert.run(next, bodyOf({ ...row, date, items }), row.id).lastInsertRowid)
        log(id, 'converted', actor)
        log(child, 'created', actor)
        return get(child)
      }).immediate()
    },
    cancel(id: number, actor: number): void {
      db.transaction(() => {
        draft(id)
        db.prepare("UPDATE doc_workflow SET status = 'cancelled' WHERE id = ?").run(id)
        log(id, 'cancelled', actor)
      }).immediate()
    }
  }
}
