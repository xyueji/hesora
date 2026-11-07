import type { TrackingItemInput } from './inventory'

export interface SaleItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

export interface SaleCreateInput {
  customer_id?: number
  warehouse_id: number
  date?: string
  remark?: string
  /** 业务员（操作员用户名） */
  operator?: string
  items: SaleItemInput[]
}

export interface SaleReturnInput extends SaleCreateInput {
  account_id?: number
  source_doc_id?: number
}

export interface SaleQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  /** 不传返回销售单+退货单；'sale' 仅销售单；'sale_return' 仅退货单 */
  type?: 'sale' | 'sale_return'
  page: number
  pageSize: number
}
