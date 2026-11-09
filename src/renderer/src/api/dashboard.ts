import { call } from './call'
import type {
  DashboardSummary,
  DashboardTrendRow,
  ReminderItem,
  TodayBrief
} from '../../../shared/types/dashboard'

export type { DashboardSummary, DashboardTrendRow, ReminderItem, TodayBrief }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dashboardApi = {
  summary: (date: string = todayStr()) => call<DashboardSummary>('dashboard:summary', date),
  trend: (days = 7) => call<DashboardTrendRow[]>('dashboard:trend', { days }),
  // [5] 日报速览（S 级功能批次 B）
  todayBrief: (date: string = todayStr()) => call<TodayBrief>('dashboard:todayBrief', { date }),
  // [6] 首页待办提醒聚合（S 级功能批次 B）
  reminders: () => call<ReminderItem[]>('dashboard:reminders')
}
