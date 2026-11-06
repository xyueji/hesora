// 打印数据装配服务（纯数据库查询 + 组装，无 Electron 依赖，可单测）。
// HTML 生成在 src/shared/print/templates.ts（同样无 Electron）。
import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { A4PrintData, ReceiptPrintData } from '../../../shared/print/templates'

export type DB = Database

interface DocRowLite {
  id: number
  no: string
  type: string
  date: string
  partner_id: number | null
  warehouse_id: number | null
  warehouse_in_id: number | null
  account_id: number | null
  total_amount: number
  remark: string | null
}

interface ItemRow {
  name: string
  unit: string
  qty: number
  price: number
  amount: number
}

const A4_TITLES: Record<string, string> = {
  purchase: '采购单',
  sale: '销售单',
  purchase_return: '采购退货单',
  sale_return: '销售退货单',
  transfer: '调拨单',
  stocktake: '盘点单',
  assemble: '组装单',
  disassemble: '拆卸单'
}

function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

export function createPrintService(db: DB) {
  function getDoc(docId: number): DocRowLite {
    const doc = db.prepare('SELECT * FROM doc WHERE id = ?').get(docId) as DocRowLite | undefined
    if (!doc) throw new BizError('NOT_FOUND', `单据不存在：${docId}`)
    return doc
  }

  function shopHeader(): string {
    const receiptHeader = db.prepare("SELECT value FROM app_setting WHERE key = 'shop.receipt_header'").get() as
      | { value: string }
      | undefined
    if (receiptHeader && receiptHeader.value) return receiptHeader.value
    const name = db.prepare("SELECT value FROM app_setting WHERE key = 'shop.name'").get() as
      | { value: string }
      | undefined
    return name && name.value ? name.value : '智销进销存'
  }

  // doc_item 无商品名——JOIN product 取名称。amount 存的是 qty*rate*price，明细行直接用存储值。
  function itemsOf(docId: number): ItemRow[] {
    return db
      .prepare(
        `SELECT COALESCE(p.name, '未知商品') AS name, i.unit, i.qty, i.price, i.amount
         FROM doc_item i LEFT JOIN product p ON p.id = i.product_id
         WHERE i.doc_id = ? ORDER BY i.id`
      )
      .all(docId) as ItemRow[]
  }

  function partnerName(partnerId: number | null, type: string): string {
    if (partnerId === null) return ''
    const table = type === 'purchase' || type === 'purchase_return' ? 'supplier' : 'customer'
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(partnerId) as
      | { name: string }
      | undefined
    return row ? row.name : ''
  }

  function warehouseName(warehouseId: number | null): string {
    if (warehouseId === null) return ''
    const row = db.prepare('SELECT name FROM warehouse WHERE id = ?').get(warehouseId) as
      | { name: string }
      | undefined
    return row ? row.name : ''
  }

  function accountName(accountId: number | null): string {
    if (accountId === null) return ''
    const row = db.prepare('SELECT name FROM fund_account WHERE id = ?').get(accountId) as
      | { name: string }
      | undefined
    return row ? row.name : ''
  }

  /** 小票打印数据：仅零售单（兜底销售单）。 */
  function receiptData(docId: number): ReceiptPrintData {
    const doc = getDoc(docId)
    if (doc.type !== 'retail' && doc.type !== 'sale') {
      throw new BizError('VALIDATION', `该单据类型不支持小票打印：${doc.type}`)
    }
    const paymentMethod = accountName(doc.account_id)
    return {
      shopName: shopHeader(),
      docNo: doc.no,
      date: doc.date,
      items: itemsOf(docId),
      total: doc.total_amount,
      paymentMethod,
      remark: doc.remark ?? '',
      footer: '谢谢惠顾'
    }
  }

  /** A4 打印数据：采购/销售/退货/调拨/盘点/组装/拆卸等业务单据。 */
  function a4Data(docId: number): A4PrintData {
    const doc = getDoc(docId)
    const title = A4_TITLES[doc.type]
    if (!title) {
      throw new BizError('VALIDATION', `该单据类型不支持 A4 打印：${doc.type}`)
    }
    return {
      title,
      shopName: shopHeader(),
      partnerName: partnerName(doc.partner_id, doc.type),
      warehouseName: warehouseName(doc.warehouse_id),
      docNo: doc.no,
      date: doc.date,
      items: itemsOf(docId),
      total: doc.total_amount,
      remark: doc.remark ?? '',
      printDate: `${todayLocal()} ${pad(new Date().getHours(), 2)}:${pad(new Date().getMinutes(), 2)}`
    }
  }

  return { receiptData, a4Data }
}

export type PrintService = ReturnType<typeof createPrintService>
