export interface RetailItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price: number
}

export interface RetailCreateInput {
  warehouse_id: number
  account_id?: number
  customer_id?: number
  date?: string
  remark?: string
  items: RetailItemInput[]
}

export interface RetailQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}
