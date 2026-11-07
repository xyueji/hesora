import type { SyncConfig, SyncNowResult, SyncRestorePreview, SyncTargetStatus } from '../../../main/services/sync/sync.service'
import { call } from './call'

export const syncApi = {
  getConfig: () => call<SyncConfig>('sync:getConfig'),
  saveConfig: (partial: Partial<SyncConfig>) => call<void>('sync:saveConfig', partial),
  now: () => call<SyncNowResult>('sync:now'),
  checkTargets: () => call<SyncTargetStatus[]>('sync:checkTargets'),
  download: (source?: 'local' | 'webdav') => call<SyncRestorePreview>('sync:download', source),
  cancelRestore: (token: string) => call<void>('sync:cancelRestore', token),
  restoreFromCloud: (token: string, acceptLocalChanges: boolean) =>
    call<{ needRestart: boolean }>('sync:restoreFromCloud', { token, acceptLocalChanges })
}
