import type { TrackingItemInput } from './inventory'

export interface TransferItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
}

export interface TransferCreateInput {
  warehouse_id: number
  warehouse_in_id: number
  date?: string
  remark?: string
  items: TransferItemInput[]
}

export interface TransferQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}
