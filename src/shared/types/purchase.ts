import type { TrackingItemInput } from './inventory'

export interface PurchaseItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

export interface PurchaseCreateInput {
  supplier_id?: number
  warehouse_id: number
  date?: string
  remark?: string
  /** 业务员（操作员用户名） */
  operator?: string
  items: PurchaseItemInput[]
}

export interface PurchaseReturnInput extends PurchaseCreateInput {
  account_id?: number
  source_doc_id?: number
}

export interface PurchaseQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  /** 不传返回采购单+退货单；'purchase' 仅采购单；'purchase_return' 仅退货单 */
  type?: 'purchase' | 'purchase_return'
  page: number
  pageSize: number
}
