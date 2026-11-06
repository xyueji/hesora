import type { BackupInfo } from '../../../main/services/backup/backup.service'
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

export const backupApi = {
  now: () => call<string>('backup:now'),
  pickDir: () => call<string | null>('backup:pickDir'),
  list: () => call<BackupInfo[]>('backup:list'),
  restore: (backupPath: string) => call<{ needRestart: boolean }>('backup:restore', backupPath)
}
