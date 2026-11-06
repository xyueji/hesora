export interface PurchaseItemInput {
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
  items: PurchaseItemInput[]
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
