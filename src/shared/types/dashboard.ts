/** 经营仪表盘汇总 */
export interface DashboardSummary {
  /** 今日销售额（仅 type='sale'，退货单未抵减 — 简化口径） */
  sales_amount: number
  /** 今日销售单张数 */
  sales_count: number
  /** 今日毛利：Σ(明细 amount) − Σ(qty*rate × 成本)。
   *  成本取同(仓库,批号)库存行的当前移动加权成本，找不到则按 0（近似口径）。 */
  gross_profit: number
  /** 今日零售额 */
  retail_amount: number
  /** 今日收款（fund_flow direction='in' doc_type='receipt'） */
  receipt_amount: number
  /** 今日付款（fund_flow direction='out' doc_type='payment'） */
  payment_amount: number
  /** 库存金额 = Σ inventory.qty * moving_cost（全量） */
  stock_amount: number
  /** 应收合计（期初 + 销售 − 收款/零售流入，同 arrears 口径） */
  total_receivable: number
  /** 应付合计（期初 + 进货 − 付款） */
  total_payable: number
}

/** 趋势行 */
export interface DashboardTrendRow {
  date: string
  amount: number
}
