import { call } from './call'
import type { DashboardSummary, DashboardTrendRow } from '../../../shared/types/dashboard'

export type { DashboardSummary, DashboardTrendRow }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dashboardApi = {
  summary: (date: string = todayStr()) => call<DashboardSummary>('dashboard:summary', date),
  trend: (days = 7) => call<DashboardTrendRow[]>('dashboard:trend', { days })
}
