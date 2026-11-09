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

/** [5] 日报速览（S 级功能批次 B） */
export interface TodayBrief {
  /** 昨日期末库存总量（所有仓 Σ inventory.qty，按查询日昨天的库存快照口径 = 当前库存减今日变动） */
  yesterday_stock_qty: number
  /** 今日销售出库量（sale 出库数量） */
  today_sale_qty: number
  /** 今日入库量（采购入库 + 销售退货入库） */
  today_in_qty: number
  /** 今日期末库存总量（当前实时 Σ inventory.qty） */
  today_stock_qty: number
}

/** [6] 首页待办提醒聚合项（S 级功能批次 B） */
export interface ReminderItem {
  type: 'stock_warn' | 'arrears' | 'expiring'
  count: number
  /** 仅库存预警附带明细（商品+缺口），便于直接展示 */
  items?: { product_name: string; shortage: number }[]
}
