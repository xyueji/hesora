// 提示式更新：纯逻辑，无 electron 依赖。fetch 通过 fetchImpl 注入，便于测试。
// 多渠道语义：按 updateUrls 顺序尝试（Gitee 优先）。渠道「失败」（网络/非 2xx/
// JSON 解析失败/字段非法/下载链接不合法）才回退到下一个；渠道「有效但无更新」
// 立即结束检查，不再回退，避免陈旧 manifest 遮蔽下游渠道的新版本。
export interface UpdateInfo {
  version: string
  notes?: string
  url?: string
  sha256?: string
}

export type UpdateSource = 'gitee' | 'github' | 'custom'

export interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion?: string
  notes?: string
  downloadUrl?: string
  source?: UpdateSource
  sha256?: string
}

export interface FetchLikeResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

export type FetchLike = (url: string) => Promise<FetchLikeResponse>

export interface UpdateServiceOptions {
  currentVersion: string
  /** 旧版单渠道配置；等价于 [updateUrl]。 */
  updateUrl?: string
  /** 有序渠道列表，建议 Gitee 在前、GitHub 在后。 */
  updateUrls?: string[]
  /** 覆盖默认下载域名白名单（传入后不再使用内置白名单）。 */
  allowHosts?: readonly string[]
  /** 覆盖「固定 tag + 固定包名」拼接配置（manifest.url 缺省时生效）。 */
  fixedAsset?: FixedAssetConfig
  fetchImpl?: FetchLike
}

const VERSION_RE = /^\d+(?:\.\d+){1,3}$/
const SHA256_RE = /^[0-9a-fA-F]{64}$/

// manifest 内下载链接的默认域名白名单。防止 manifest 被篡改后把下载指向任意地址。
// *.gitee.com 覆盖 Gitee release 附件最终跳转域名 foruda.gitee.com。
const DEFAULT_ALLOW_HOSTS: readonly string[] = [
  'github.com',
  '*.githubusercontent.com',
  'github.io',
  '*.github.io',
  'gitee.com',
  '*.gitee.com',
  'gitee.io',
  '*.gitee.io',
  'raw.giteeusercontent.com',
  '*.giteeusercontent.com'
]

/**
 * Gitee 的 `/raw/<branch>/latest.json` 一定会 302 跳到 raw.giteeusercontent.com
 * （带一次性签名 query），因此必须允许跟随重定向；若用 redirect:'error' 会让 Gitee 渠道
 * 每次都抛异常并回退 GitHub，令「Gitee 优先」形同虚设。manifest 只解析为 JSON、不执行，
 * 且目标 URL 由内置/env 提供（https、无凭据），跟随一次跳转安全。
 * 导出该常量便于单测断言，防止回归到 'error'（值本身不含 signal）。
 */
export const DEFAULT_REDIRECT = 'follow' as const

/**
 * 默认 fetch：AbortSignal.timeout 必须**每次请求新建**。
 * 若把 signal 提到模块级常量，进程运行超过 10s 后该 signal 已 aborted，
 * 之后所有真实更新检查都会立即 reject 并被静默判为 { hasUpdate:false }，双渠道功能全废。
 * 这是从 fe03745 之前的「内联 per-request signal」重构时极易引入的回归，故保留工厂形态。
 */
function defaultFetch(url: string): Promise<FetchLikeResponse> {
  return fetch(url, { signal: AbortSignal.timeout(10000), redirect: DEFAULT_REDIRECT })
}

/**
 * 固定下载约定：用户要求「点更新就能完成更新」，因此 tag 恒为 `latest`、
 * 附件名恒为 `hesora-inventory-setup.exe`，每次发版覆盖同一 tag 的附件。
 * manifest 的 url 可省略，省略时按此约定拼接 Gitee release 附件地址。
 * 该 Gitee/GitHub 仓库是纯分发渠道（仅 latest.json + 安装包附件），不是源码仓库；
 * 客户端全程匿名 HTTPS 读取，不含任何 token/凭据。
 */
export const UPDATE_RELEASE_TAG = 'latest'
export const UPDATE_PACKAGE_NAME = 'hesora-inventory-setup.exe'
export const DEFAULT_RELEASE_BASE_URL = `https://gitee.com/xyueji/hesora/releases/download/${UPDATE_RELEASE_TAG}`

export interface FixedAssetConfig {
  /** release 附件目录，末尾不含 /。 */
  releaseBaseUrl: string
  /** 固定附件名。 */
  packageName: string
}

export const DEFAULT_FIXED_ASSET: FixedAssetConfig = {
  releaseBaseUrl: DEFAULT_RELEASE_BASE_URL,
  packageName: UPDATE_PACKAGE_NAME
}

/**
 * 纯函数：manifest 显式给了 url 就用它；否则按固定 tag + 固定包名拼接下载地址。
 * 注意：拼接结果仍须通过白名单校验后才允许交给 update:openUrl（见 checkChannel）。
 */
export function resolveDownloadUrl(
  manifestUrl: string | undefined,
  fixed: FixedAssetConfig = DEFAULT_FIXED_ASSET
): string {
  if (typeof manifestUrl === 'string' && manifestUrl.trim() !== '') return manifestUrl
  return `${fixed.releaseBaseUrl.replace(/\/+$/, '')}/${fixed.packageName}`
}

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

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  const p = pattern.toLowerCase()
  if (p.startsWith('*.')) return h.endsWith(`.${p.slice(2)}`)
  return h === p
}

function isHostAllowed(host: string, allowHosts: readonly string[]): boolean {
  return allowHosts.some((pattern) => hostMatches(host, pattern))
}

function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isAllowedDownloadUrl(raw: string, allowHosts: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  return isHostAllowed(url.hostname, allowHosts)
}

function sourceFromUrl(updateUrl: string): UpdateSource {
  let host: string
  try {
    host = new URL(updateUrl).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  if (
    host === 'gitee.com' ||
    host.endsWith('.gitee.com') ||
    host === 'gitee.io' ||
    host.endsWith('.gitee.io') ||
    host === 'giteeusercontent.com' ||
    host.endsWith('.giteeusercontent.com')
  ) {
    return 'gitee'
  }
  if (
    host === 'github.com' ||
    host.endsWith('.github.com') ||
    host === 'githubusercontent.com' ||
    host.endsWith('.githubusercontent.com')
  ) {
    return 'github'
  }
  return 'custom'
}

type ChannelOutcome =
  | { kind: 'failed' }
  | { kind: 'no-update' }
  | { kind: 'update'; result: UpdateCheckResult }

export function createUpdateService(options: UpdateServiceOptions) {
  const urls: string[] =
    options.updateUrls && options.updateUrls.length > 0
      ? [...options.updateUrls]
      : options.updateUrl
        ? [options.updateUrl]
        : []
  const allowHosts: readonly string[] = options.allowHosts ?? DEFAULT_ALLOW_HOSTS
  const fixedAsset: FixedAssetConfig = options.fixedAsset ?? DEFAULT_FIXED_ASSET
  const fetchImpl: FetchLike = options.fetchImpl ?? defaultFetch

  async function checkChannel(updateUrl: string): Promise<ChannelOutcome> {
    // manifest 地址本身也必须是合法 https 且不带凭据；非法渠道直接判失败。
    if (!isValidUrl(updateUrl)) return { kind: 'failed' }
    let res: FetchLikeResponse
    try {
      res = await fetchImpl(updateUrl)
    } catch {
      return { kind: 'failed' }
    }
    if (!res.ok) return { kind: 'failed' }

    let raw: string
    try {
      raw = await res.text()
    } catch {
      return { kind: 'failed' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return { kind: 'failed' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'failed' }
    const info = parsed as Record<string, unknown>

    if (typeof info.version !== 'string' || !VERSION_RE.test(info.version)) return { kind: 'failed' }

    if (info.notes !== undefined && typeof info.notes !== 'string') return { kind: 'failed' }
    if (info.sha256 !== undefined) {
      if (typeof info.sha256 !== 'string' || !SHA256_RE.test(info.sha256)) return { kind: 'failed' }
    }
    if (info.url !== undefined && typeof info.url !== 'string') return { kind: 'failed' }
    const downloadUrl = resolveDownloadUrl(info.url as string | undefined, fixedAsset)
    // 显式 url 与拼接出的固定地址都要过白名单校验。
    if (!isAllowedDownloadUrl(downloadUrl, allowHosts)) return { kind: 'failed' }

    // 有效 manifest 且版本不比当前新：立即结束，绝不回退下游渠道。
    if (!isNewerVersion(info.version as string, options.currentVersion)) return { kind: 'no-update' }

    const result: UpdateCheckResult = {
      hasUpdate: true,
      latestVersion: info.version as string,
      notes: info.notes as string | undefined,
      downloadUrl,
      source: sourceFromUrl(updateUrl)
    }
    if (typeof info.sha256 === 'string') result.sha256 = info.sha256
    return { kind: 'update', result }
  }

  async function check(): Promise<UpdateCheckResult> {
    try {
      for (const updateUrl of urls) {
        const outcome = await checkChannel(updateUrl)
        if (outcome.kind === 'update') return outcome.result
        if (outcome.kind === 'no-update') return { hasUpdate: false }
      }
      // 全部渠道失败（或没配置渠道）：静默返回无更新。
      return { hasUpdate: false }
    } catch {
      // 绝不抛出：断网/异常时离线使用不受影响。
      return { hasUpdate: false }
    }
  }

  return { check }
}

export type UpdateService = ReturnType<typeof createUpdateService>
