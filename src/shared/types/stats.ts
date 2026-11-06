/** 应收应付统计行 */
export interface ArrearsRow {
  partner_id: number
  partner_name: string
  opening: number
  /** 应收方向：销售额；应付方向：采购额 */
  amount: number
  /** 已收 / 已付 */
  settled: number
  balance: number
}

/** 应收应付汇总 */
export interface ArrearsSummary {
  total_receivable: number
  total_payable: number
}
