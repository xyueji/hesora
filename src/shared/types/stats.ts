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

/** 账龄区间行：某往来单位落在各账龄档的未结金额 */
export interface AgingRow {
  partner_id: number
  partner_name: string
  /** 未结总额（含期初） */
  total: number
  /** 0-30 天 */
  b0_30: number
  /** 31-60 天 */
  b31_60: number
  /** 61-90 天 */
  b61_90: number
  /** 90 天以上 */
  b90plus: number
  /** 最早一笔未结单据/期初日期 */
  oldest: string | null
}

export interface AgingResult {
  asOf: string
  customers: AgingRow[]
  suppliers: AgingRow[]
}
