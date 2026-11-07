import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { DOC_NO_PREFIX } from '../../../shared/types/doc'
import type { CopiedDocResult, DocCopyOverrides, DocItemRow, DocType } from '../../../shared/types/doc'

export type DB = Database

/** 允许"再来一单"的单据类型：购销与零售类业务单据。 */
const COPYABLE_TYPES: readonly DocType[] = [
  'purchase',
  'sale',
  'retail',
  'purchase_return',
  'sale_return'
]

interface DocDbRow {
  id: number
  no: string
  type: string
  date: string
  partner_id: number | null
  warehouse_id: number | null
  warehouse_in_id: number | null
  account_id: number | null
  source_doc_id: number | null
  total_amount: number
  remark: string | null
  status: string
  created_at: string
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

/**
 * 单据复制服务（"再来一单"）。
 *
 * 语义：复制一张已存在的单据，生成一张新的**草稿**单据：
 *  - 新单号沿用同一套编号规则（前缀 + yyyyMMdd + 4 位流水）；
 *  - 明细行（商品、单位、换算率、数量、单价、金额）原样复制；
 *  - **不产生任何库存变动**——复制只是开单草稿，库存等新单保存过账时才动；
 *  - 只允许改日期 / 往来单位 / 备注。
 */
export function createDocCopyService(db: DB) {
  const insertDoc = db.prepare(`
    INSERT INTO doc (no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark, source_doc_id, status)
    VALUES (@no, @type, @date, @partner_id, @warehouse_id, @warehouse_in_id, @account_id, @total_amount, @remark, @source_doc_id, 'draft')
  `)
  const insertItem = db.prepare(`
    INSERT INTO doc_item (doc_id, product_id, warehouse_id, batch_no, unit, rate, qty, price, amount)
    VALUES (@doc_id, @product_id, @warehouse_id, @batch_no, @unit, @rate, @qty, @price, @amount)
  `)

  /**
   * 生成新单号：前缀 + yyyyMMdd + 4 位流水。
   * 与 doc.service 的编号规则保持一致（同一张 doc 表，因此序号连续且不会重号）。
   */
  function nextNo(type: DocType, date: string): string {
    const compact = date.replace(/-/g, '')
    const prefix = `${DOC_NO_PREFIX[type]}${compact}`
    const { last } = db
      .prepare('SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS last FROM doc WHERE type = ? AND date = ?')
      .get(prefix.length + 1, type, date) as { last: number | null }
    return `${prefix}${pad((last ?? 0) + 1, 4)}`
  }

  function assertPartnerExists(partnerId: number): void {
    const row = db
      .prepare('SELECT id FROM customer WHERE id = ? UNION ALL SELECT id FROM supplier WHERE id = ?')
      .get(partnerId, partnerId)
    if (!row) {
      throw new BizError('NOT_FOUND', '往来单位不存在')
    }
  }

  function copy(docId: number, overrides?: DocCopyOverrides): CopiedDocResult {
    const id = Number(docId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new BizError('VALIDATION', '单据ID无效')
    }
    const source = db.prepare('SELECT * FROM doc WHERE id = ?').get(id) as DocDbRow | undefined
    if (!source) {
      throw new BizError('NOT_FOUND', '单据不存在')
    }
    const type = source.type as DocType
    if (!COPYABLE_TYPES.includes(type)) {
      throw new BizError('VALIDATION', '该单据类型不支持复制')
    }
    const items = db
      .prepare('SELECT * FROM doc_item WHERE doc_id = ? ORDER BY id')
      .all(id) as DocItemRow[]
    if (items.length === 0) {
      throw new BizError('VALIDATION', '原单没有明细，无法复制')
    }
    const date = overrides?.date ?? source.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BizError('VALIDATION', '单据日期格式应为 yyyy-MM-dd')
    }
    const partnerId =
      overrides?.partner_id === undefined || overrides.partner_id === null
        ? source.partner_id
        : Number(overrides.partner_id)
    if (partnerId !== null) {
      assertPartnerExists(partnerId)
    }
    const remark =
      overrides === undefined || !('remark' in overrides)
        ? source.remark
        : (overrides.remark ?? null)

    const totalAmount = items.reduce((sum, it) => sum + Number(it.amount), 0)
    let newId = 0
    let newNo = ''
    const newItems: DocItemRow[] = []
    db.transaction(() => {
      newNo = nextNo(type, date)
      newId = Number(
        insertDoc.run({
          no: newNo,
          type,
          date,
          partner_id: partnerId,
          warehouse_id: source.warehouse_id,
          warehouse_in_id: source.warehouse_in_id,
          account_id: source.account_id,
          total_amount: totalAmount,
          remark,
          source_doc_id: source.id
        }).lastInsertRowid
      )
      for (const it of items) {
        const itemId = Number(
          insertItem.run({
            doc_id: newId,
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            batch_no: it.batch_no ?? '',
            unit: it.unit ?? '',
            rate: it.rate,
            qty: it.qty,
            price: it.price,
            amount: it.amount
          }).lastInsertRowid
        )
        newItems.push({
          id: itemId,
          doc_id: newId,
          product_id: it.product_id,
          warehouse_id: it.warehouse_id,
          batch_no: it.batch_no ?? '',
          unit: it.unit ?? '',
          rate: it.rate,
          qty: it.qty,
          price: it.price,
          amount: it.amount
        })
      }
    }).immediate()

    return {
      id: newId,
      no: newNo,
      type,
      date,
      status: 'draft',
      partner_id: partnerId,
      warehouse_id: source.warehouse_id,
      warehouse_in_id: source.warehouse_in_id,
      account_id: source.account_id,
      source_doc_id: source.id,
      total_amount: totalAmount,
      remark,
      copied_from_no: source.no,
      items: newItems
    }
  }

  return { copy, COPYABLE_TYPES }
}

export type DocCopyService = ReturnType<typeof createDocCopyService>
