/**
 * 库存查询扩展（统计明细 / 成本变动 / 收发存 / 库存预警 / 调价）的共享类型。
 * 主进程服务与渲染层共用，避免口径漂移。
 */

import { DOC_TYPE_LABELS } from './doc'

/* ---------------------------------- 成本变动来源 ---------------------------------- */

/** 库存变动来源中文名：单据类来源复用 DOC_TYPE_LABELS，非单据类来源在此补充 */
export const COST_SOURCE_LABELS: Record<string, string> = {
  ...DOC_TYPE_LABELS,
  opening: '期初',
  import: '导入',
  adjust: '库存调整',
  manual: '手工调整',
  other: '其他'
}

/** 成本变动来源下拉选项（渲染层筛选用） */
export const COST_SOURCE_OPTIONS: { value: string; label: string }[] = Object.entries(
  COST_SOURCE_LABELS
).map(([value, label]) => ({ value, label }))

/* ---------------------------------- 库存统计明细 ---------------------------------- */

export interface StatsDetailQuery {
  /** 商品编码或名称模糊匹配 */
  keyword?: string
  product_id?: number
  warehouse_id?: number
  page: number
  pageSize: number
}

export interface StatsDetailRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  qty: number
  /** 移动加权平均成本单价 */
  moving_cost: number
  /** qty * moving_cost */
  amount: number
}

export interface StatsDetailTotals {
  /** 筛选范围内合计数量 */
  qty: number
  /** 筛选范围内合计金额 */
  amount: number
}

export interface StatsDetailPage {
  /** 满足条件的明细行总数 */
  total: number
  items: StatsDetailRow[]
  /** 合计行（全量口径，非当前页） */
  totals: StatsDetailTotals
}

/* ---------------------------------- 成本变动明细 ---------------------------------- */

export interface CostChangeQuery {
  /** 商品编码/名称或单据号模糊匹配 */
  keyword?: string
  product_id?: number
  warehouse_id?: number
  /** 变动来源（purchase/sale/opening/...） */
  source?: string
  /** 起始日期 YYYY-MM-DD（含） */
  date_from?: string
  /** 截止日期 YYYY-MM-DD（含） */
  date_to?: string
  page: number
  pageSize: number
}

export interface CostChangeRow {
  id: number
  /** 变动时间 */
  created_at: string
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  /** 来源标识（原始值） */
  source: string
  /** 来源中文名 */
  source_label: string
  /** 关联单据号；非单据来源为空串 */
  source_no: string
  /** 变动数量（入库为正、出库为负） */
  change_qty: number
  /** 变动单位成本 */
  unit_cost: number
  /** 变动金额 = change_qty * unit_cost */
  change_amount: number
  /** 变动前结存数量 */
  before_qty: number
  /** 变动前结存金额 */
  before_amount: number
  /** 变动后结存数量 */
  after_qty: number
  /** 变动后结存金额 */
  after_amount: number
  /** 变动后结存单位成本 */
  after_cost: number
}

export interface CostChangeTotals {
  /** 合计变动数量 */
  change_qty: number
  /** 合计变动金额 */
  change_amount: number
  /** 合计笔数 */
  count: number
}

export interface CostChangePage {
  total: number
  items: CostChangeRow[]
  /** 合计行（全量口径，非当前页） */
  totals: CostChangeTotals
}

/* ---------------------------------- 库存流水（收发存） ---------------------------------- */

export interface StockFlowQuery {
  keyword?: string
  product_id?: number
  warehouse_id?: number
  /** 起始日期 YYYY-MM-DD（含）；期初结存为该日期之前的结存 */
  date_from?: string
  /** 截止日期 YYYY-MM-DD（含） */
  date_to?: string
}

export interface StockFlowRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  warehouse_id: number
  warehouse_name: string
  /** 期初结存数量 */
  open_qty: number
  /** 本期入库数量 */
  in_qty: number
  /** 本期出库数量 */
  out_qty: number
  /** 期末结存数量 = 期初 + 入库 - 出库 */
  close_qty: number
  /** 期初结存金额 */
  open_amount: number
  /** 本期入库金额 */
  in_amount: number
  /** 本期出库金额 */
  out_amount: number
  /** 期末结存金额 = 期初 + 入库 - 出库 */
  close_amount: number
}

export interface StockFlowTotals {
  open_qty: number
  in_qty: number
  out_qty: number
  close_qty: number
  open_amount: number
  in_amount: number
  out_amount: number
  close_amount: number
}

export interface StockFlowResult {
  items: StockFlowRow[]
  totals: StockFlowTotals
}

/* ---------------------------------- 库存预警 ---------------------------------- */

export interface WarningQuery {
  keyword?: string
  warehouse_id?: number
  page: number
  pageSize: number
}

export type WarningStatus = '缺货' | '低于预警值' | '超储'

export interface WarningRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  /** 当前库存合计数量 */
  qty: number
  /** 预警值（未设置时按 0 处理） */
  min_stock: number
  /** 差额 = 预警值 - 当前数量 */
  diff: number
  status: WarningStatus
  /** P3：安全库存上限（null 表示未设置上限） */
  max_stock: number | null
  /** P3：类型分组：low = 缺货/低于预警值，over = 超储 */
  warn_kind: 'low' | 'over'
}

export interface WarningTotals {
  /** 预警商品数 */
  count: number
  /** 预警商品当前库存合计 */
  qty: number
  /** 差额合计 */
  diff: number
}

export interface WarningPage {
  total: number
  items: WarningRow[]
  totals: WarningTotals
}

/** 设置单个商品预警值 */
export interface SetWarningInput {
  product_id: number
  min_stock: number
}

/** 按条件批量设置预警值 */
export interface SetWarningsByConditionInput {
  /** 商品编码或名称模糊匹配 */
  keyword?: string
  /** 仅匹配当前预警值等于该值的商品 */
  min_stock?: number
}

export interface SetWarningsResult {
  /** 被更新的商品数 */
  updated: number
}

/* ---------------------------------- 调整售价 ---------------------------------- */

export type PriceType = 'retail' | 'trade' | 'purchase'

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  retail: '零售价',
  trade: '批发价',
  purchase: '进价'
}

export interface AdjustPriceItem {
  product_id: number
  retail_price?: number
  trade_price?: number
  purchase_price?: number
}

export interface AdjustPriceInput {
  items: AdjustPriceItem[]
  /** 操作人 */
  operator?: string
}

export interface PriceAdjustLogRow {
  id: number
  product_id: number
  price_type: PriceType
  old_price: number
  new_price: number
  operator: string | null
  created_at: string
}

export interface AdjustPriceResult {
  /** 调整的价格项数量（= logs 长度） */
  updated: number
  /** 涉及商品数 */
  products: number
  logs: PriceAdjustLogRow[]
}

/** P2：采购建议行（min_stock>0 且现库存<min_stock） */
export interface PurchaseSuggestion {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  min_stock: number
  current_qty: number
  suggest_qty: number
}

export interface PurchaseSuggestionQuery {
  warehouse_id?: number
}

/* ---------------------------------- 滞销商品 ---------------------------------- */

/** 滞销商品查询参数：days = 近 N 天无销售出库（默认 30） */
export interface UnsoldQuery {
  days?: number
  warehouse_id?: number
}

/** 滞销商品行：有库存（inventory.qty > 0）但近 N 天无 sale/retail 出库 */
export interface UnsoldRow {
  product_id: number
  code: string
  name: string
  spec: string
  base_unit: string
  qty: number
  /** 最近一次销售出库时间（口径内为 null = N 天内无出库） */
  last_out: string | null
}
