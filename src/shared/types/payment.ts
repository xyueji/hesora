import type { DocRow } from './doc'

export type PaymentType = 'receipt' | 'payment' | 'other_in' | 'other_out'

/** 收付款单创建输入（收款单/付款单共用，partner_id 为客户或供应商，可空） */
export interface PaymentCreateInput {
  partner_id?: number
  account_id?: number
  /** [10] 收支科目 id（写入 fund_flow.category_id，S 级功能批次 B） */
  category_id?: number
  accounts?: { account_id: number; amount: number }[]
  allocations?: { doc_id: number; amount: number; /** 本次核销让利金额（核销金额+优惠=本次销账金额），缺省 0 */ preferential?: number }[]
  amount: number
  date?: string
  remark?: string
  /** P1 功能 #2 预存款：'prepaid' 计入预存款（不核销）；'prepaid_refund' 退预存款（扣减）；缺省 'normal' 直接核销 */
  charge_type?: 'normal' | 'prepaid' | 'prepaid_refund'
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
  allocations: { doc_id: number; no: string; amount: number; preferential?: number }[]
}
