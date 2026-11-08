/** 经营仪表盘汇总 */
export interface DashboardSummary {
  /** 今日销售额（仅 type='sale'，退货单未抵减 — 简化口径） */
  sales_amount: number
  /** 今日销售单张数 */
  sales_count: number
  /** 今日销售单金额减出库时的成本，无权限时为 null。 */
  gross_profit: number | null
  /** 今日零售额 */
  retail_amount: number
  /** 今日收款（fund_flow direction='in' doc_type='receipt'） */
  receipt_amount: number
  /** 今日付款（fund_flow direction='out' doc_type='payment'） */
  payment_amount: number
  /** 库存金额 = Σ inventory.qty * moving_cost（全量） */
  stock_amount: number
  low_stock_count: number
  /** 未来 30 天内到期的批次数（不含已过期） */
  expiring_batch_count: number
  /** 已过期批次数 */
  expired_batch_count: number
  /** 应收合计，沿用往来余额报表口径。 */
  total_receivable: number
  /** 应付合计（期初 + 进货 − 付款） */
  total_payable: number
}

/** 趋势行 */
export interface DashboardTrendRow {
  date: string
  amount: number
}
