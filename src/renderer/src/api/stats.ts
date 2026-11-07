import { call } from './call'
import type { ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'
import type { ReportPage, ReportQuery } from '../../../shared/types/report'

export { type ArrearsRow, type ArrearsSummary } from '../../../shared/types/stats'

export const arrearsApi = {
  receivables: () => call<ArrearsRow[]>('stats:receivables'),
  payables: () => call<ArrearsRow[]>('stats:payables'),
  summary: () => call<ArrearsSummary>('stats:summary')
}

export const reportApi = {
  query: (query: ReportQuery) => call<ReportPage>('stats:report', query)
}
