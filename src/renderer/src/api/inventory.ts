import type { Result } from '../../../shared/result'
import type { StockPageResult, StockQuery } from '../../../shared/types/inventory'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const inventoryApi = {
  queryStock: (q: StockQuery) => call<StockPageResult>('inventory:queryStock', q)
}
