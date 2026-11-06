import type { Result } from '../../../shared/result'
import type { OpeningPayload, OpeningStatus } from '../../../shared/types/opening'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const openingApi = {
  save: (payload: OpeningPayload) => call<void>('opening:save', payload),
  getStatus: () => call<OpeningStatus>('opening:getStatus')
}
