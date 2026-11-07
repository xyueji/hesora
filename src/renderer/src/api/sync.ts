import type { SyncConfig, SyncNowResult } from '../../../main/services/sync/sync.service'
import { call } from './call'

export const syncApi = {
  getConfig: () => call<SyncConfig>('sync:getConfig'),
  saveConfig: (partial: Partial<SyncConfig>) => call<void>('sync:saveConfig', partial),
  now: () => call<SyncNowResult>('sync:now'),
  download: () => call<string>('sync:download'),
  restoreFromCloud: (tempPath: string) => call<{ needRestart: boolean }>('sync:restoreFromCloud', tempPath)
}
