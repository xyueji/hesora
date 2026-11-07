import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { WORKFLOW_CONVERSIONS, WORKFLOW_KINDS, type WorkflowInput, type WorkflowKind, type WorkflowRow } from '../../../shared/types/workflow'
import { createPurchaseService } from '../purchase/purchase.service'
import { createSaleService } from '../sale/sale.service'

type StoredRow = Pick<WorkflowRow, 'id' | 'status' | 'kind' | 'source_id' | 'posted_doc_id' | 'posted_doc_no' | 'converted_id' | 'approved_by'> & { body: string }
type Event = 'created' | 'edited' | 'approved' | 'cancelled' | 'converted'

function toRow(stored: StoredRow): WorkflowRow {
  const { body, ...metadata } = stored
  return { ...JSON.parse(body) as WorkflowInput, ...metadata }
}

export function createWorkflowService(db: Database) {
  const sale = createSaleService(db)
  const purchase = createPurchaseService(db)
  const select = `SELECT w.*, d.no AS posted_doc_no, next.id AS converted_id
    FROM doc_workflow w LEFT JOIN doc d ON d.id = w.posted_doc_id
    LEFT JOIN doc_workflow next ON next.source_id = w.id AND next.status <> 'cancelled'`
  const insert = db.prepare('INSERT INTO doc_workflow (kind, body, source_id) VALUES (?, ?, ?)')
  const event = db.prepare('INSERT INTO doc_workflow_event (workflow_id, action, operator_id) VALUES (?, ?, ?)')
  const log = (id: number, action: Event, actor: number) => event.run(id, action, actor)

  function get(id: number): WorkflowRow {
    const row = db.prepare(`${select} WHERE w.id = ?`).get(id) as StoredRow | undefined
    if (!row) throw new BizError('NOT_FOUND', '单据不存在')
    return toRow(row)
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
      if (!product.get(item.product_id)) throw new BizError('VALIDATION', '明细包含不存在或停用的商品')
      const rate = item.rate ?? 1
      if (!Number.isFinite(item.qty * rate) || item.qty <= 0 || rate <= 0 || !Number.isFinite(item.price) || item.price < 0 || !Number.isFinite(item.qty * item.price)) {
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
    list(page = 1, kind?: WorkflowKind): { list: WorkflowRow[]; total: number } {
      const params = kind ? [kind] : []
      const filter = kind ? 'WHERE w.kind = ?' : ''
      const offset = Math.max(0, (Math.max(1, Math.floor(page) || 1) - 1) * 30)
      const list = db.prepare(`${select} ${filter} ORDER BY w.id DESC LIMIT 30 OFFSET ?`).all(...params, offset) as StoredRow[]
      const total = db.prepare(`SELECT COUNT(*) FROM doc_workflow w ${filter}`).pluck().get(...params) as number
      return { list: list.map(toRow), total }
    },
    save(input: WorkflowInput, actor: number): WorkflowRow {
      return db.transaction(() => {
        validate(input)
        if (input.id !== undefined) {
          const row = draft(input.id)
          if (row.kind !== input.kind) throw new BizError('VALIDATION', '保存后不能更改单据类型')
          db.prepare('UPDATE doc_workflow SET body = ? WHERE id = ?').run(bodyOf(input), row.id)
          log(row.id, 'edited', actor)
          return get(row.id)
        }
        const id = Number(insert.run(input.kind, bodyOf(input), null).lastInsertRowid)
        log(id, 'created', actor)
        return get(id)
      }).immediate()
    },
    approve(id: number, actor: number): WorkflowRow {
      return db.transaction(() => {
        const row = draft(id)
        validate(row)
        const posted = row.kind === 'purchase'
          ? purchase.create({ ...row, supplier_id: row.partner_id })
          : row.kind === 'sale' ? sale.create({ ...row, customer_id: row.partner_id }) : null
        db.prepare("UPDATE doc_workflow SET status = 'approved', posted_doc_id = ?, approved_by = ? WHERE id = ?")
          .run(posted?.id ?? null, actor, id)
        log(id, 'approved', actor)
        return get(id)
      }).immediate()
    },
    convert(id: number, actor: number, target?: WorkflowKind): WorkflowRow {
      return db.transaction(() => {
        const row = get(id)
        const targets = WORKFLOW_CONVERSIONS[row.kind]
        const next = target ?? targets?.[0]
        if (row.status === 'draft') throw new BizError('VALIDATION', '单据需先审核通过才能转单')
        if (row.status !== 'approved') throw new BizError('VALIDATION', '已作废的单据不能转单')
        if (!next || !targets?.includes(next)) {
          throw new BizError('VALIDATION', '当前单据不支持该类型的转单')
        }
        if (row.converted_id !== null) throw new BizError('DOC_DONE', '该单据已转单')
        const child = Number(insert.run(next, bodyOf(row), row.id).lastInsertRowid)
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
