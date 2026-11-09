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

/** 价格等级：零售价 / 批发价 / 会员价 等，名称自定义 */
export interface PriceLevel {
  price_level: string
  price: number
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
  /** P3：安全库存上限（NULL/未设置表示不预警超储） */
  max_stock?: number | null
  /** P3：货架号 */
  shelf_no?: string
  images?: string[]
  /** P3：提成率（%，默认 0） */
  commission_rate?: number
  remark?: string
  tracking_type: TrackingType
  /** 商品类型：standard 标准商品 / combo 组合商品 */
  kind?: ProductKind
  /** 组合商品 BOM（kind='combo' 时必填非空） */
  bom?: BomItem[]
  units?: ProductUnit[]
  barcodes?: string[]
  disabled?: boolean
  /** 保质期天数（天） */
  shelf_life_days?: number
  /** 临期预警提前天数（未设置时按 30 天判定） */
  shelf_life_warn_days?: number
  /** 价格等级列表（整体读写） */
  price_levels?: PriceLevel[]
  /** P2：自定义属性 {attr_id: value} 映射（整体读写） */
  attributes?: Record<string, string>
  /** P3：新建时的初始批次（仅批次追踪商品；开启批号必录后必须至少一条带 batch_no） */
  initial_batches?: { batch_no: string; production_date?: string; expire_date?: string }[]
}

/** P2：属性字典行（如 颜色 → 红/蓝） */
export interface ProductAttribute {
  id: number
  name: string
  /** 可选值 JSON 数组字符串 */
  options: string
  created_at?: string
}

export interface ProductQuery extends PageQuery {
  category?: string
  kind?: ProductKind
  /** P3：货架号模糊筛选 */
  shelf_no?: string
  /** P2：按属性值筛选（attr_id → 期望值，多值 AND） */
  attr_filters?: Record<string, string>
}

/** 保质期设置 */
export interface ShelfLifeConfig {
  shelf_life_days?: number | null
  shelf_life_warn_days?: number | null
}

/** 批次效期状态 */
export type BatchStatus = '正常' | '临期' | '已过期'

/** 批次效期行（含商品/仓库冗余名称，便于列表直接展示） */
export interface ProductBatch {
  qty?: number
  id: number
  product_id: number
  warehouse_id: number
  batch_no: string
  production_date?: string
  expire_date?: string
  remark?: string
  product_code: string
  product_name: string
  warehouse_name: string
  /** 剩余天数：负数表示已过期；无到期日期时为 null */
  remaining_days: number | null
  status: BatchStatus
}

export interface BatchQuery extends PageQuery {
  product_id?: number
  warehouse_id?: number
  /** 仅看临期批次 */
  only_expiring?: boolean
  /** 仅看已过期批次 */
  only_expired?: boolean
}
