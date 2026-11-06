import type { PageQuery } from './common'

export type TrackingType = 'none' | 'batch' | 'serial'

export interface ProductUnit {
  unit: string
  rate: number
  is_base?: boolean
}

export interface Product {
  id?: number
  code: string
  name: string
  spec?: string
  category?: string
  base_unit: string
  retail_price: number
  trade_price: number
  purchase_price: number
  min_stock?: number | null
  images?: string[]
  remark?: string
  tracking_type: TrackingType
  units?: ProductUnit[]
  barcodes?: string[]
  disabled?: boolean
}

export interface ProductQuery extends PageQuery {
  category?: string
}
