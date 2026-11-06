import type { SyncConfig, SyncNowResult } from '../../../main/services/sync/sync.service'
import type { Result } from '../../../shared/result'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const syncApi = {
  getConfig: () => call<SyncConfig>('sync:getConfig'),
  saveConfig: (partial: Partial<SyncConfig>) => call<void>('sync:saveConfig', partial),
  now: () => call<SyncNowResult>('sync:now'),
  download: () => call<string>('sync:download'),
  restoreFromCloud: (tempPath: string) => call<{ needRestart: boolean }>('sync:restoreFromCloud', tempPath)
}
