import type { Result } from '../../../shared/result'
import type { ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'

export { type ArrearsRow, type ArrearsSummary } from '../../../shared/types/stats'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const arrearsApi = {
  receivables: () => call<ArrearsRow[]>('stats:receivables'),
  payables: () => call<ArrearsRow[]>('stats:payables'),
  summary: () => call<ArrearsSummary>('stats:summary')
}
