import { call } from './call'
import type { AgingResult, ArrearsRow, ArrearsSummary, StatementResult, PartnerAgingResult } from '../../../shared/types/stats'
import type { ReportPage, ReportQuery } from '../../../shared/types/report'

export { type ArrearsRow, type ArrearsSummary, type AgingResult, type AgingRow } from '../../../shared/types/stats'

export const arrearsApi = {
  receivables: () => call<ArrearsRow[]>('stats:receivables'),
  payables: () => call<ArrearsRow[]>('stats:payables'),
  summary: () => call<ArrearsSummary>('stats:summary'),
  aging: (asOf?: string) => call<AgingResult>('stats:aging', asOf ? { asOf } : undefined)
}

export const reportApi = {
  query: (query: ReportQuery) => call<ReportPage>('stats:report', query)
}

export interface OperatorPerformanceQuery {
  date_from?: string
  date_to?: string
  /** 业务员关键字（模糊匹配 doc.operator） */
  operator?: string
}

export interface OperatorPerformanceRow {
  operator: string | null
  sales_amount: number
  return_amount: number
  doc_count: number
  gross_profit: number
}

export const operatorPerformanceApi = {
  query: (query: OperatorPerformanceQuery) =>
    call<OperatorPerformanceRow[]>('stats:operatorPerformance', query)
}

/** [10] 科目资金汇总行（S 级功能批次 B） */
export interface FundSummaryCategoryRow {
  category_id: number
  category_name: string
  category_kind: string | null
  income: number
  expense: number
  net: number
}

export const fundSummaryByCategoryApi = {
  query: (query: { date_from?: string; date_to?: string }) =>
    call<FundSummaryCategoryRow[]>('stats:fundSummaryByCategory', query)
}

// ── P1 功能 #1：客商对账单明细 + 账龄分析 ──
export const statementApi = {
  statement: (query: { partner_id: number; partner_type: 'customer' | 'supplier'; date_from?: string; date_to?: string }) =>
    call<StatementResult>('stats:statement', query),
  aging: (query: { partner_type: 'customer' | 'supplier'; as_of?: string }) =>
    call<PartnerAgingResult>('stats:partnerAging', query)
}
