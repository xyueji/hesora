import type { DocRow } from './doc'

export type PaymentType = 'receipt' | 'payment' | 'other_in' | 'other_out'

/** 收付款单创建输入（收款单/付款单共用，partner_id 为客户或供应商，可空） */
export interface PaymentCreateInput {
  partner_id?: number
  account_id?: number
  accounts?: { account_id: number; amount: number }[]
  allocations?: { doc_id: number; amount: number }[]
  amount: number
  date?: string
  remark?: string
}

export interface SettlementDocument {
  id: number
  no: string
  date: string
  total_amount: number
  remaining: number
}

/** 资金流水行 */
export interface FundFlowRow {
  id: number
  account_id: number
  account_name?: string
  doc_type: string
  doc_id: number
  amount: number
  direction: 'in' | 'out'
  date: string
  remark: string | null
  created_at: string
}

/** 收付款单详情：单据（无明细行）+ 资金流水 */
export interface PaymentDetail {
  doc: DocRow
  flow: FundFlowRow | null
  flows: FundFlowRow[]
  allocations: { doc_id: number; no: string; amount: number }[]
}
