import type { Result } from '../../../shared/result'

export interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion?: string
  notes?: string
  downloadUrl?: string
}

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

const LAST_CHECK_KEY = 'update.lastCheckAt'
const DAY_MS = 24 * 60 * 60 * 1000

export const updateApi = {
  check: () => call<UpdateCheckResult>('update:check'),
  openUrl: (url: string) => call<boolean>('update:openUrl', url),
  // 每天最多检查一次：localStorage 记录上次检查时间戳。
  async checkDaily(): Promise<UpdateCheckResult | null> {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? '0')
    if (Date.now() - last < DAY_MS) return null
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
    try {
      return await updateApi.check()
    } catch {
      return null
    }
  }
}
