// 提示式更新：纯逻辑，无 electron 依赖。fetch 通过 fetchImpl 注入，便于测试。
export interface UpdateInfo {
  version: string
  notes?: string
  url?: string
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion?: string
  notes?: string
  downloadUrl?: string
}

export interface FetchLikeResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type FetchLike = (url: string) => Promise<FetchLikeResponse>

// 简单语义比较：按 '.' 分段逐段数值比较，段数不足按 0 补齐。
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = String(candidate ?? '')
    .split('.')
    .map((s) => Number(s) || 0)
  const b = String(current ?? '')
    .split('.')
    .map((s) => Number(s) || 0)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export function createUpdateService(options: {
  currentVersion: string
  updateUrl: string
  fetchImpl?: FetchLike
}) {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u: string) => fetch(u) as Promise<FetchLikeResponse>)

  async function check(): Promise<UpdateCheckResult> {
    try {
      const res = await fetchImpl(options.updateUrl)
      if (!res.ok) return { hasUpdate: false }
      const raw = await res.text()
      let info: UpdateInfo
      try {
        info = JSON.parse(raw) as UpdateInfo
      } catch {
        return { hasUpdate: false }
      }
      if (!info || typeof info.version !== 'string') return { hasUpdate: false }
      if (!isNewerVersion(info.version, options.currentVersion)) return { hasUpdate: false }
      return {
        hasUpdate: true,
        latestVersion: info.version,
        notes: info.notes,
        downloadUrl: info.url
      }
    } catch {
      // 网络失败等任何异常：静默返回无更新，绝不抛出
      return { hasUpdate: false }
    }
  }

  return { check }
}

export type UpdateService = ReturnType<typeof createUpdateService>
