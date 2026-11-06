import type { Result } from '../../../shared/result'
import type { DashboardSummary, DashboardTrendRow } from '../../../shared/types/dashboard'

export type { DashboardSummary, DashboardTrendRow }

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dashboardApi = {
  summary: (date: string = todayStr()) => call<DashboardSummary>('dashboard:summary', date),
  trend: (days = 7) => call<DashboardTrendRow[]>('dashboard:trend', { days })
}
