import { call } from './call'
import type { AgingResult, ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'
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
