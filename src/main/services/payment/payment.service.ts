import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { DOC_TYPE_LABELS } from '../../../shared/types/doc'
import type { DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import type { FundFlowRow, PaymentCreateInput, PaymentDetail, PaymentType } from '../../../shared/types/payment'
import { createDocService, type DocService } from '../doc/doc.service'

export type DB = Database

interface FlowDbRow {
  id: number
  account_id: number
  doc_type: string
  doc_id: number
  amount: number
  direction: string
  date: string
  remark: string | null
  created_at: string
}

function toFlowRow(row: FlowDbRow): FundFlowRow {
  return { ...row, direction: row.direction as FundFlowRow['direction'] }
}

/**
 * 收付款单服务：收款单（type=receipt，编号 SK…，资金流入）与付款单（type=payment，编号 FK…，资金流出）。
 * 不涉及商品明细（doc_item 为空），金额记在 doc.total_amount，同时写入资金流水 fund_flow。
 */
export function createPaymentService(db: DB) {
  const docService: DocService = createDocService(db)
  const insertFlow = db.prepare(`
    INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
    VALUES (@account_id, @doc_type, @doc_id, @amount, @direction, @date, @remark)
  `)

  function getFlowByDoc(docId: number): FundFlowRow | null {
    const row = db
      .prepare('SELECT * FROM fund_flow WHERE doc_id = ? ORDER BY id LIMIT 1')
      .get(docId) as FlowDbRow | undefined
    return row ? toFlowRow(row) : null
  }

  function createOne(type: PaymentType, input: PaymentCreateInput): DocRow {
    if (!['receipt', 'payment', 'other_in', 'other_out'].includes(type)) {
      throw new BizError('VALIDATION', '无效的资金单据类型')
    }
    const accountId = Number(input.account_id)
    if (!Number.isInteger(accountId)) {
      throw new BizError('VALIDATION', '结算账户不能为空')
    }
    const acc = db.prepare('SELECT id FROM fund_account WHERE id = ? AND disabled = 0').get(accountId)
    if (!acc) throw new BizError('NOT_FOUND', '账户不存在或已停用')
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BizError('VALIDATION', '金额必须大于0')
    }
    if (input.partner_id !== undefined && input.partner_id !== null) {
      if (type === 'other_in' || type === 'other_out') {
        throw new BizError('VALIDATION', '其他收支不计入往来余额')
      }
      const table = type === 'receipt' ? 'customer' : 'supplier'
      const p = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(input.partner_id))
      if (!p) {
        throw new BizError('NOT_FOUND', type === 'receipt' ? '客户不存在' : '供应商不存在')
      }
    }
    let doc: DocRow | undefined
    db.transaction(() => {
      doc = docService.create({
        type,
        date: input.date,
        partner_id: input.partner_id ?? undefined,
        account_id: accountId,
        remark: input.remark,
        items: []
      })
      const docId = doc!.id
      // 收款单/付款单无明细行，金额直接记在单据合计上。
      db.prepare('UPDATE doc SET total_amount = ? WHERE id = ?').run(amount, docId)
      insertFlow.run({
        account_id: accountId,
        doc_type: type,
        doc_id: docId,
        amount,
        direction: type === 'receipt' || type === 'other_in' ? 'in' : 'out',
        date: doc!.date,
        remark: input.remark ?? null
      })
      doc = { ...doc!, total_amount: amount }
    })()
    return doc as DocRow
  }

  /** 收款单：客户付款流入，编号 SKyyyyMMddNNNN */
  function createReceipt(input: PaymentCreateInput): DocRow {
    return createOne('receipt', input)
  }

  /** 付款单：向供应商付款流出，编号 FKyyyyMMddNNNN */
  function createPayment(input: PaymentCreateInput): DocRow {
    return createOne('payment', input)
  }

  function getDetail(type: PaymentType, id: number): PaymentDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== type) {
      throw new BizError('NOT_FOUND', `${DOC_TYPE_LABELS[type]}不存在：${id}`)
    }
    return { doc, flow: getFlowByDoc(id) }
  }

  function query(
    type: PaymentType,
    q: Omit<DocQuery, 'type'>
  ): DocPageResult {
    return docService.query({ ...q, type })
  }

  return {
    createOne,
    createReceipt,
    createPayment,
    getDetail,
    query,
    getReceiptDetail: (id: number) => getDetail('receipt', id),
    getPaymentDetail: (id: number) => getDetail('payment', id),
    queryReceipt: (q: Omit<DocQuery, 'type'>) => query('receipt', q),
    queryPayment: (q: Omit<DocQuery, 'type'>) => query('payment', q)
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
