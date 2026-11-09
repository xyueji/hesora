import type { TrackingItemInput } from './inventory'

export interface RetailItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

/** 组合收款单腿：一个收款账户 + 该腿实收金额。 */
export interface RetailPaymentLeg {
  account_id: number
  amount: number
}

export interface RetailCreateInput {
  held_id?: number
  warehouse_id: number
  /** 单一收款账户（向后兼容）；指定 payments 时忽略此字段。 */
  account_id?: number
  /** 多账户组合收款：每腿各写一条 fund_flow（direction 'in'），金额之和应等于折后总额。 */
  payments?: RetailPaymentLeg[]
  /** 整单折扣率：0 < discount <= 1；total_amount = Σ(amount) * discount（四舍五入两位）。 */
  discount?: number
  customer_id?: number
  date?: string
  remark?: string
  /** 业务员（操作员用户名） */
  operator?: string
  /** P1 功能 #2 预存款抵扣：从 customer.prepaid 扣减的金额（需 ≤ 预存款余额；散客不可用） */
  prepaid_amount?: number
  /** 让利闭环：整单优惠（立减）金额，≥0 且 < 折后商品合计；与 discount 并存时 netTotal = Σ(amount)*discount − preferential */
  preferential?: number
  items: RetailItemInput[]
}

export interface RetailHeldCart {
  id: number
  updated_at: string
  input: Omit<RetailCreateInput, 'held_id'>
}

export interface RetailQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}
