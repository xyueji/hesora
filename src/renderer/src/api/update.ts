import { call } from './call'

export interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion?: string
  notes?: string
  downloadUrl?: string
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
