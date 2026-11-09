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

// ── P1 功能 #1：客商对账单明细 ──

/** 对账单请求：某客商全部往来明细 */
export interface StatementQuery {
  partner_id: number
  partner_type: 'customer' | 'supplier'
  date_from?: string
  date_to?: string
}

/** 对账单明细行（方向：increase 增加应收/应付，decrease 冲减） */
export interface StatementLine {
  date: string
  no: string
  /** 单据类型：sale/retail/sale_return/receipt 或 purchase/purchase_return/payment */
  type: string
  amount: number
  direction: 'increase' | 'decrease'
  /** 该行涉及的已核销金额（收付款行 = 核销合计；交易行 = 已被核销金额） */
  allocated: number
  /** 逐笔滚动后的余额 */
  balance: number
  doc_id: number
  remark: string | null
}

/** 对账单结果 */
export interface StatementResult {
  partner_id: number
  partner_name: string
  partner_type: 'customer' | 'supplier'
  date_from: string | null
  date_to: string | null
  opening_balance: number
  lines: StatementLine[]
  closing_balance: number
}

// ── P1 功能 #1：账龄分析（按未核销单据日期分桶） ──

/** 账龄请求 */
export interface AgingQuery {
  partner_type: 'customer' | 'supplier'
  as_of?: string
}

/** 单客商账龄行 */
export interface PartnerAgingRow {
  partner_id: number
  partner_name: string
  balance: number
  bucket_0_30: number
  bucket_31_60: number
  bucket_61_90: number
  bucket_90p: number
}

export interface PartnerAgingResult {
  as_of: string
  rows: PartnerAgingRow[]
  total: PartnerAgingRow
}
