import type { PageQuery } from './common'

export type TrackingType = 'none' | 'batch' | 'serial'
export type ProductKind = 'standard' | 'combo'

export interface ProductUnit {
  unit: string
  rate: number
  is_base?: boolean
}

/** 组合商品（BOM）子件行：qty 为该子件相对基本单位的用量 */
export interface BomItem {
  product_id: number
  qty: number
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
  /** 商品类型：standard 标准商品 / combo 组合商品 */
  kind?: ProductKind
  /** 组合商品 BOM（kind='combo' 时必填非空） */
  bom?: BomItem[]
  units?: ProductUnit[]
  barcodes?: string[]
  disabled?: boolean
}

export interface ProductQuery extends PageQuery {
  category?: string
  kind?: ProductKind
}
