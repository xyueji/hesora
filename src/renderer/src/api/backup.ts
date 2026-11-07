import type { BackupInfo } from '../../../main/services/backup/backup.service'
import { call } from './call'

export const backupApi = {
  now: () => call<string>('backup:now'),
  pickDir: () => call<string | null>('backup:pickDir'),
  list: () => call<BackupInfo[]>('backup:list'),
  restore: (backupPath: string) => call<{ needRestart: boolean }>('backup:restore', backupPath)
}
