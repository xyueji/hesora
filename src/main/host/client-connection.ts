// v1.4 客户端接线（本机作为 LAN 客户端连接主机的角色）。
// 职责：
//  ① 客户端连接状态机（idle/pairing/connecting/connected/revoked/error）+ 状态广播；
//  ② 配对流程：POST /pair/start → 轮询 GET /pair/result → granted 取 secret+指纹 →
//     POST /auth/session（HMAC 签名，用配对 secret）→ 建立 LanClient 会话；
//  ③ 凭据持久化：secret/指纹/token 走 DPAPI（secret-store 的 host-scoped 存取），
//     DPAPI 不可用时**只降级为内存态、绝不明文落盘**；非敏感字段（主机地址/设备名/deviceId）
//     存 app_setting；
//  ④ 断线重连后 flush pending（幂等通道按原 requestId 重发，主机侧幂等表保证只生效一次）；
//  ⑤ 吊销检测：主机 WS close(4003) 或 invoke 返回 E_AUTH_FAILED/E_NOT_PAIRED → 'revoked'。
// 本模块不 import electron（禁顶层 electron 约束的同款自律）：safeStorage 由 index.ts 注入，
// 渲染层只经 IPC（见 preload/index.ts 的 'lan:invoke' 与 'lan:client-*' 通道）。
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { createHash, randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { ok, fail, type Result } from '../../shared/result'
import { signPayloadHex } from './auth'
import { createLanClient, type LanClient, type LanClientDeps } from './lan-client'
import { createHostEventsClient, type HostEventsClient } from './host-events-client'
import type { PendingRegistryDeps } from './pending-registry'
import type { HostCredentialStore } from './client-credentials'

/** 客户端连接状态（与主机侧 lan:state-changed 的布尔态**互不混淆**）。 */
export type ClientConnectionStatus = 'idle' | 'pairing' | 'connecting' | 'connected' | 'revoked' | 'error'

export interface ClientConnectionState {
  status: ClientConnectionStatus
  /** 主机地址（规范化后，如 https://192.168.1.10:18650） */
  hostAddress: string | null
  /** 本机设备名（配对时下发给主机） */
  deviceName: string | null
  /** 主机分配的 deviceId（HMAC 签名用） */
  deviceId: string | null
  /** 主机上的登录账号名（登录成功后回填） */
  hostName: string | null
  /** 最近一次错误文案（说人话，渲染层直接展示） */
  lastError: string | null
  /** 最近一次错误码（如 E_FEATURE_PRO / E_HOST_UNREACHABLE） */
  lastErrorCode: string | null
  /** 最近一次连接成功时间（ISO 字符串） */
  lastConnectedAt: string | null
  /** 配对码（等待主机确认期间展示） */
  pairingCode: string | null
  /** 配对码过期时间（Unix ms） */
  pairingExpiresAt: number | null
  /** 是否已配置过主机（存在持久化配置） */
  configured: boolean
  /** 默认建议地址（本机局域网 IP + 主机默认端口） */
  suggestedAddress: string
}

/** 主机默认端口（server.ts 默认 18650，手册 §3.3 同值）。 */
export const HOST_DEFAULT_PORT = 18650

const POLL_INTERVAL_MS = 2_000
const REQUEST_TIMEOUT_MS = 8_000

export interface ClientConnectionDeps {
  /** app_setting 读（非敏感字段）。 */
  getSetting: (key: string) => string | null
  /** app_setting 写（非敏感字段）。 */
  setSetting: (key: string, value: string) => void
  /** DPAPI 凭据存储（host-scoped）；null = 不可用 → 只降级内存态。 */
  credentialStore: HostCredentialStore | null
  now?: () => number
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** 状态变化广播（接线层转发给渲染层 'lan:client-state'）。 */
  onStateChanged?: (state: ClientConnectionState) => void
  /** 授权门控：抛异常表示不允许进入客户端模式（E_FEATURE_PRO 等）。 */
  assertLicensed?: () => void
  /** LanClient 工厂（测试可注入替身）。 */
  createClient?: (deps: LanClientDeps) => LanClient
  /** pending 幂等登记的落盘（接线层注入 fs 实现；退出 flush 时持久化）。 */
  pendingPersist?: PendingRegistryDeps
  /** 轮询间隔（测试可缩短）。 */
  pollIntervalMs?: number
  /** 请求超时（测试可缩短）。 */
  requestTimeoutMs?: number
}

export interface ClientConnection {
  status(): ClientConnectionState
  /** 申请配对（主机地址/本机设备名/主机账号密码）→ 立即返回配对码，后台轮询等待主机确认。 */
  pairStart(input: { address: string; deviceName: string; username: string; password: string }): Promise<Result<{ pairingCode: string; expiresAt: number }>>
  /** 用已保存的配对凭据重新登录主机（不重新走配对码流程）。 */
  reconnect(input: { username: string; password: string }): Promise<Result>
  /** 主动断开（保留配对信息，下次可 reconnect）。 */
  disconnect(): Result
  /** 忘记主机（清除本机保存的主机配置与凭据）。 */
  forget(): Result
  /** 业务通道透传（main 侧 'lan:invoke' handler 调用）。 */
  invoke(channel: string, payload: unknown): Promise<Result>
  /** 启动时恢复：读取已保存配置与凭据，能续则续（会话 token 仍在有效期内）。 */
  restore(): Promise<Result>
  /** 退出 flush：pending 落盘（PendingRegistry.flush → persist），重启后按原 requestId 重发。 */
  flushPending(): void
  /** pending 条数（诊断用）。 */
  pendingSize(): number
  /** 重连成功后按原 requestId 幂等重发 pending（接线层/测试可显式触发）。 */
  resendPending(): Promise<void>
  /** 订阅状态变化（接线层用；亦可依赖 deps.onStateChanged）。 */
  onStateChanged(cb: (state: ClientConnectionState) => void): void
}

const SETTING_HOST_ADDRESS = 'client.host_address'
const SETTING_DEVICE_NAME = 'client.device_name'
const SETTING_DEVICE_ID = 'client.device_id'

interface JsonResponse {
  status: number
  body: unknown
}

/** 局域网 IPv4 建议地址（无网卡时回退 127.0.0.1）。 */
export function suggestedHostAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const it of list ?? []) {
      if (it.family === 'IPv4' && !it.internal) return `https://${it.address}:${HOST_DEFAULT_PORT}`
    }
  }
  return `https://127.0.0.1:${HOST_DEFAULT_PORT}`
}

/** 主机地址规范化：补 scheme、补默认端口、去尾斜杠。 */
export function normalizeHostAddress(raw: string): string | null {
  let s = String(raw ?? '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!u.hostname) return null
  const port = u.port || String(HOST_DEFAULT_PORT)
  return `${u.protocol}//${u.hostname}:${port}`
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** 解析 {ok,code,msg,data} 形态的响应体（非法 JSON → null）。 */
function parseResultBody(body: unknown): Result | null {
  if (!body || typeof body !== 'object') return null
  const o = body as { ok?: unknown; code?: unknown; msg?: unknown; data?: unknown }
  if (typeof o.ok !== 'boolean') return null
  return {
    ok: o.ok,
    code: typeof o.code === 'string' ? o.code : o.ok ? 'OK' : 'E_UNKNOWN',
    msg: typeof o.msg === 'string' ? o.msg : '',
    data: o.data ?? null
  }
}

export function createClientConnection(deps: ClientConnectionDeps): ClientConnection {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS
  const requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const createClient = deps.createClient ?? createLanClient

  const state: ClientConnectionState = {
    status: 'idle',
    hostAddress: null,
    deviceName: null,
    deviceId: null,
    hostName: null,
    lastError: null,
    lastErrorCode: null,
    lastConnectedAt: null,
    pairingCode: null,
    pairingExpiresAt: null,
    configured: false,
    suggestedAddress: suggestedHostAddress()
  }

  /** 内存态凭据（DPAPI 可用时同时落盘；不可用时仅内存）。 */
  const creds: { secretHex: string | null; fingerprintHex: string | null; token: string | null } = {
    secretHex: null,
    fingerprintHex: null,
    token: null
  }

  let client: LanClient | null = null
  let events: HostEventsClient | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pairingRun = 0 // 配对轮询代次（取消旧轮询用）
  const stateListeners: ((s: ClientConnectionState) => void)[] = []

  function snapshot(): ClientConnectionState {
    return { ...state }
  }

  function emit(): void {
    const s = snapshot()
    deps.onStateChanged?.(s)
    for (const cb of stateListeners) {
      try {
        cb(s)
      } catch (e) {
        log('warn', `client state listener failed: ${String(e)}`)
      }
    }
  }

  function setStatus(status: ClientConnectionStatus, err?: { code: string; msg: string }): void {
    state.status = status
    if (err) {
      state.lastError = err.msg
      state.lastErrorCode = err.code
    } else if (status === 'connected' || status === 'idle') {
      state.lastError = null
      state.lastErrorCode = null
    }
    emit()
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    pairingRun++
  }

  function persistProfile(): void {
    if (state.hostAddress) deps.setSetting(SETTING_HOST_ADDRESS, state.hostAddress)
    if (state.deviceName) deps.setSetting(SETTING_DEVICE_NAME, state.deviceName)
    if (state.deviceId) deps.setSetting(SETTING_DEVICE_ID, state.deviceId)
  }

  function persistCredentials(): void {
    if (!deps.credentialStore || !state.hostAddress) return
    deps.credentialStore.save(state.hostAddress, {
      secretHex: creds.secretHex ?? '',
      fingerprintHex: creds.fingerprintHex ?? '',
      token: creds.token ?? ''
    })
  }

  function loadCredentials(hostAddress: string): void {
    const store = deps.credentialStore
    if (!store) return
    const values = store.load(hostAddress)
    creds.secretHex = values.secretHex || null
    creds.fingerprintHex = values.fingerprintHex || null
    creds.token = values.token || null
  }

  // ---- HTTP 助手（配对阶段使用；此时还没有可信指纹，允许自签证书）----
  function requestJson(method: 'GET' | 'POST', url: string, opts?: { body?: string; headers?: Record<string, string> }): Promise<JsonResponse> {
    return new Promise<JsonResponse>((resolve, reject) => {
      let u: URL
      try {
        u = new URL(url)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      const isHttps = u.protocol === 'https:'
      const mod = isHttps ? httpsRequest : httpRequest
      const reqOpts: RequestOptions = {
        method,
        headers: { 'content-type': 'application/json', ...(opts?.headers ?? {}) },
        timeout: requestTimeoutMs
      }
      if (isHttps) {
        // ⚠ 配对阶段的一次性握手：此时客户端尚无可信指纹（TOFU 不采信），
        // 只能先放行自签证书完成握手；granted 拿到主机指纹后，lan-client 的
        // pinning 立即生效（后续请求逐条比对 sha256(peerCert.raw)）。
        reqOpts.rejectUnauthorized = false
      }
      const req = mod(u, reqOpts, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: unknown = null
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            parsed = null
          }
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      })
      req.on('timeout', () => {
        req.destroy(new Error('请求超时'))
      })
      req.on('error', (e: Error) => reject(e))
      if (opts?.body !== undefined) req.write(opts.body)
      req.end()
    })
  }

  function networkError(e: unknown): { code: string; msg: string } {
    const raw = e instanceof Error ? e.message : String(e)
    if (/timeout|超时/i.test(raw)) return { code: 'E_HOST_UNREACHABLE', msg: '无法连接主机（超时），请检查地址与网络' }
    return { code: 'E_HOST_UNREACHABLE', msg: `无法连接主机：${raw}` }
  }

  // ---- 配对流程 ----
  interface PairingStart {
    pairingCode: string
    expiresAt: number
    /** 主机 TLS 证书指纹（/pair/start 下发）；granted 时必须非空且与 granted 一致。 */
    fingerprintHex: string | null
  }
  async function startPairing(address: string, deviceName: string): Promise<Result<PairingStart>> {
    const res = await requestJson('POST', `${address}/pair/start`, { body: JSON.stringify({ deviceName }) })
    const r = parseResultBody(res.body)
    if (!r || !r.ok) {
      const code = r?.code ?? 'E_PAIRING_FAILED'
      const msg = r?.msg || '主机拒绝了配对请求'
      return fail(code, msg)
    }
    const data = (r.data ?? {}) as { pairingCode?: unknown; expiresAt?: unknown; fingerprintHex?: unknown }
    const pairingCode = typeof data.pairingCode === 'string' ? data.pairingCode : ''
    const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : now() + 300_000
    if (!pairingCode) return fail('E_PAIRING_FAILED', '主机未返回配对码')
    const startFingerprint = typeof data.fingerprintHex === 'string' && data.fingerprintHex
      ? data.fingerprintHex.toLowerCase()
      : null
    return ok({ pairingCode, expiresAt, fingerprintHex: startFingerprint })
  }

  /** 轮询 /pair/result 直到 granted/denied/expired。 */
  function pollPairResult(address: string, pairingCode: string, run: number, startFingerprint: string | null): void {
    const tick = async (): Promise<void> => {
      if (run !== pairingRun) return
      let res: JsonResponse
      try {
        res = await requestJson('GET', `${address}/pair/result?code=${encodeURIComponent(pairingCode)}`)
      } catch (e) {
        if (run !== pairingRun) return
        const err = networkError(e)
        setStatus('error', err)
        return
      }
      if (run !== pairingRun) return
      const r = parseResultBody(res.body)
      if (!r) {
        setStatus('error', { code: 'E_PAIRING_FAILED', msg: '主机响应异常，配对失败' })
        return
      }
      if (!r.ok) {
        // 主机限流（RATE_LIMIT / 429）是临时性失败：退避后续轮询，不终止配对。
        // 5 分钟 TTL 内 2s 一趟合法轮询可能因瞬时拥塞撞上探测限流，
        // 直接置 error 会让店长必须重新申请配对码（v1.4 终审 B1）。
        if (r.code === 'RATE_LIMIT' || res.status === 429) {
          pollTimer = setTimeout(() => void tick(), pollIntervalMs)
          return
        }
        setStatus('error', { code: r.code, msg: r.msg || '配对失败' })
        return
      }
      const data = (r.data ?? {}) as {
        status?: unknown
        secret?: unknown
        deviceId?: unknown
        deviceName?: unknown
        fingerprintHex?: unknown
      }
      const st = String(data.status ?? '')
      if (st === 'pending') {
        pollTimer = setTimeout(() => void tick(), pollIntervalMs)
        return
      }
      if (st === 'denied') {
        state.pairingCode = null
        state.pairingExpiresAt = null
        setStatus('error', { code: 'E_PAIRING_DENIED', msg: '主机拒绝了本次配对请求' })
        return
      }
      if (st === 'expired') {
        state.pairingCode = null
        state.pairingExpiresAt = null
        setStatus('error', { code: 'E_PAIRING_EXPIRED', msg: '配对码已过期，请重新申请配对' })
        return
      }
      if (st === 'granted') {
        const secretHex = typeof data.secret === 'string' ? data.secret : ''
        const deviceId = typeof data.deviceId === 'string' ? data.deviceId : ''
        const grantedFingerprint = typeof data.fingerprintHex === 'string' ? data.fingerprintHex.toLowerCase() : null
        if (!secretHex || !deviceId) {
          setStatus('error', { code: 'E_PAIRING_FAILED', msg: '主机下发的配对凭据不完整' })
          return
        }
        // 指纹是后续 /rpc、/events pinning 的唯一信任锚，必须两端都非空且一致。
        // 任一为空说明主机未下发或响应被篡改，禁止继续 /auth/session（会带明文口令）。
        if (!startFingerprint || !grantedFingerprint || startFingerprint !== grantedFingerprint) {
          setStatus('error', { code: 'E_FINGERPRINT_MISMATCH', msg: '主机证书指纹缺失或不一致，请重新配对' })
          return
        }
        state.deviceId = deviceId
        state.deviceName = typeof data.deviceName === 'string' && data.deviceName ? data.deviceName : state.deviceName
        state.pairingCode = null
        state.pairingExpiresAt = null
        creds.secretHex = secretHex
        creds.fingerprintHex = grantedFingerprint
        persistProfile()
        persistCredentials()
        setStatus('connecting')
        void completeSession()
        return
      }
      setStatus('error', { code: 'E_PAIRING_FAILED', msg: '主机返回了未知的配对状态' })
    }
    pollTimer = setTimeout(() => void tick(), pollIntervalMs)
  }

  /** 主机账号登录 → 会话 token → 建立 LanClient。 */
  async function completeSession(): Promise<Result> {
    const address = state.hostAddress
    const secretHex = creds.secretHex
    const deviceId = state.deviceId
    if (!address || !secretHex || !deviceId) {
      return fail('E_NOT_PAIRED', '尚未与主机配对')
    }
    const username = pendingUsername
    const password = pendingPassword
    if (!username || !password) {
      return fail('VALIDATION', '请先输入主机账号与密码')
    }
    const body = JSON.stringify({ employee: username, password })
    const ts = Math.floor(now() / 1000)
    const nonce = randomBytes(32).toString('hex')
    const sig = signPayloadHex(secretHex, deviceId, ts, nonce, sha256hex(body))
    let res: JsonResponse
    try {
      res = await requestJson('POST', `${address}/auth/session`, {
        body,
        headers: {
          'x-ts': String(ts),
          'x-nonce': nonce,
          'x-device-id': deviceId,
          'x-sig': sig
        }
      })
    } catch (e) {
      const err = networkError(e)
      setStatus('error', err)
      return fail(err.code, err.msg)
    }
    const r = parseResultBody(res.body)
    if (!r || !r.ok) {
      const code = r?.code ?? 'E_AUTH_FAILED'
      const msg = code === 'E_AUTH_FAILED'
        ? '登录失败：账号密码错误或设备已被吊销，请重新输入或重新申请配对'
        : r?.msg || '登录主机失败'
      setStatus('error', { code, msg })
      return fail(code, msg)
    }
    const data = (r.data ?? {}) as { token?: unknown; user?: unknown }
    const token = typeof data.token === 'string' ? data.token : ''
    if (!token) {
      setStatus('error', { code: 'E_AUTH_FAILED', msg: '主机未返回会话令牌' })
      return fail('E_AUTH_FAILED', '主机未返回会话令牌')
    }
    const user = data.user as { username?: unknown } | undefined
    creds.token = token
    persistCredentials()
    // 明文口令只在登录窗口内使用，成功后立即从内存清除。
    clearPendingCredentials()
    if (typeof user?.username === 'string') state.hostName = user.username
    ensureClient()
    client?.setConnected(true)
    state.lastConnectedAt = new Date(now()).toISOString()
    state.configured = true
    setStatus('connected')
    connectEvents()
    // token 只留在主进程（lan-client / events 用），绝不回传渲染层：
    // /events 升级仅凭 bearer token，渲染层拿到即可从 LAN 任意机器订阅事件（v1.4 终审 S4）。
    return ok(null)
  }

  let pendingUsername = ''
  let pendingPassword = ''

  /** 授权门控异常 → Result 错误码/文案（pairStart/reconnect/restore/invoke 共用）。 */
  function licenseError(e: unknown): { code: string; msg: string } {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'E_FEATURE_PRO'
    const msg = e instanceof Error ? e.message : '此功能为专业版专属，请升级授权'
    return { code, msg }
  }

  function clearPendingCredentials(): void {
    pendingUsername = ''
    pendingPassword = ''
  }

  function ensureClient(): LanClient {
    if (client) return client
    client = createClient({
      getBaseUrl: () => state.hostAddress,
      getSecretHex: () => creds.secretHex,
      getFingerprintHex: () => creds.fingerprintHex,
      getToken: () => creds.token,
      getDeviceId: () => state.deviceId ?? '',
      pendingPersist: deps.pendingPersist,
      onStateChanged: (connected) => {
        if (connected) {
          state.lastConnectedAt = new Date(now()).toISOString()
          setStatus('connected')
          void resendPending()
          connectEvents()
        } else if (state.status === 'connected') {
          setStatus('connecting', { code: 'E_HOST_UNREACHABLE', msg: '与主机的连接已断开，正在自动重连…' })
        }
      },
      onAuthFailed: () => {
        // E_AUTH_FAILED 只说明会话 token 失效/过期（8h TTL），不等于设备被吊销：
        // 引导用户重新输账号密码登录即可，避免误进 revoked 需店长再确认（v1.4 终审 S3）。
        markSessionExpired()
      }
    })
    return client
  }

  function connectEvents(): void {
    if (!state.hostAddress || !creds.token) return
    if (!events) {
      events = createHostEventsClient({
        getBaseUrl: () => state.hostAddress,
        getToken: () => creds.token,
        getFingerprintHex: () => creds.fingerprintHex,
        onRevoked: () => markRevoked('与主机的连接已被吊销，请重新配对'),
        log: (msg) => log('warn', `[client-events] ${msg}`)
      })
    }
    events.connect()
  }

  function markRevoked(msg: string): void {
    if (state.status === 'revoked') return
    stopPolling()
    // 吊销后必须关掉 WS：否则 host-events-client 对非 4003/4001 关闭会无限后台重连。
    events?.close()
    events = null
    client?.setConnected(false)
    client?.reconnect().stop()
    creds.token = null
    clearPendingCredentials()
    persistCredentials()
    setStatus('revoked', { code: 'E_NOT_PAIRED', msg })
  }

  /** 会话过期/token 失效：可重新登录恢复，区别于真吊销（4003/revoked_at）。 */
  function markSessionExpired(): void {
    // 真吊销与在途 session:ping 的 401 会竞态：WS 4003 已置 revoked 时，
    // 迟到的 E_AUTH_FAILED 不得把状态覆写成 error（否则 UI 显示「重连主机」
    // 而非「已被吊销」，且会拿失效 secret 反复登录）。
    if (state.status === 'revoked') return
    stopPolling()
    events?.close()
    events = null
    client?.setConnected(false)
    client?.reconnect().stop()
    creds.token = null
    clearPendingCredentials()
    persistCredentials()
    // 'error' + configured=true → ClientConnectView 显示「重连主机」入口。
    setStatus('error', { code: 'E_SESSION_EXPIRED', msg: '会话已过期，请重新输入主机账号密码重连' })
  }

  /** 重连成功后按原 requestId 幂等重发 pending（只有登记过的幂等通道才会进 pending）。 */
  async function resendPending(): Promise<void> {
    const c = client
    if (!c) return
    const entries = c.pending().all()
    for (const entry of entries) {
      try {
        // 同一 requestId → 主机幂等表命中缓存 → 只生效一次。
        await c.invoke(entry.channel, entry.payload, { requestId: entry.requestId })
      } catch (e) {
        log('warn', `pending flush failed for ${entry.channel}: ${String(e)}`)
      }
    }
  }

  // ---- 对外接口 ----
  async function pairStart(input: {
    address: string
    deviceName: string
    username: string
    password: string
  }): Promise<Result<{ pairingCode: string; expiresAt: number }>> {
    if (state.status === 'pairing' || state.status === 'connecting') {
      return fail('VALIDATION', '配对或连接正在进行中，请稍候')
    }
    // 授权门控（v1.4 B9）：客户端模式需本机授权含 lan_collaboration（专业版）；试用期内放行。
    try {
      deps.assertLicensed?.()
    } catch (e) {
      const err = licenseError(e)
      setStatus('error', err)
      return fail(err.code, err.msg)
    }
    const address = normalizeHostAddress(input.address)
    if (!address) {
      const msg = '主机地址无效（示例：https://192.168.1.10:18650）'
      setStatus('error', { code: 'VALIDATION', msg })
      return fail('VALIDATION', msg)
    }
    const deviceName = String(input.deviceName ?? '').trim()
    if (!deviceName) {
      const msg = '请填写本机设备名'
      setStatus('error', { code: 'VALIDATION', msg })
      return fail('VALIDATION', msg)
    }
    pendingUsername = String(input.username ?? '').trim()
    pendingPassword = String(input.password ?? '')
    if (!pendingUsername || !pendingPassword) {
      const msg = '请输入主机账号与密码'
      setStatus('error', { code: 'VALIDATION', msg })
      return fail('VALIDATION', msg)
    }
    stopPolling()
    state.hostAddress = address
    state.deviceName = deviceName
    state.hostName = null
    state.lastError = null
    state.lastErrorCode = null
    setStatus('pairing')
    const started = await startPairing(address, deviceName)
    if (!started.ok) {
      setStatus('error', { code: started.code, msg: started.msg })
      return started
    }
    const data = started.data
    if (!data) {
      const msg = '主机未返回配对信息'
      setStatus('error', { code: 'E_PAIRING_FAILED', msg })
      return fail('E_PAIRING_FAILED', msg)
    }
    state.pairingCode = data.pairingCode
    state.pairingExpiresAt = data.expiresAt
    emit()
    const run = pairingRun
    pollPairResult(address, data.pairingCode, run, data.fingerprintHex)
    return ok({ pairingCode: data.pairingCode, expiresAt: data.expiresAt })
  }

  async function reconnect(input: { username: string; password: string }): Promise<Result> {
    try {
      deps.assertLicensed?.()
    } catch (e) {
      const err = licenseError(e)
      setStatus('error', err)
      return fail(err.code, err.msg)
    }
    if (!state.hostAddress || !creds.secretHex) {
      return fail('E_NOT_PAIRED', '尚未与主机配对，请先申请配对')
    }
    if (state.status === 'pairing' || state.status === 'connecting') {
      return fail('VALIDATION', '配对或连接正在进行中，请稍候')
    }
    pendingUsername = String(input.username ?? '').trim()
    pendingPassword = String(input.password ?? '')
    if (!pendingUsername || !pendingPassword) {
      return fail('VALIDATION', '请输入主机账号与密码')
    }
    setStatus('connecting')
    return completeSession()
  }

  function disconnect(): Result {
    stopPolling()
    events?.close()
    events = null
    client?.setConnected(false)
    client?.reconnect().stop()
    creds.token = null
    clearPendingCredentials()
    persistCredentials()
    state.pairingCode = null
    state.pairingExpiresAt = null
    setStatus('idle')
    return ok(null)
  }

  function forget(): Result {
    stopPolling()
    events?.close()
    events = null
    client?.setConnected(false)
    client?.reconnect().stop()
    client = null
    if (state.hostAddress) deps.credentialStore?.remove(state.hostAddress)
    deps.setSetting(SETTING_HOST_ADDRESS, '')
    deps.setSetting(SETTING_DEVICE_NAME, '')
    deps.setSetting(SETTING_DEVICE_ID, '')
    creds.secretHex = null
    creds.fingerprintHex = null
    creds.token = null
    clearPendingCredentials()
    state.hostAddress = null
    state.deviceName = null
    state.deviceId = null
    state.hostName = null
    state.pairingCode = null
    state.pairingExpiresAt = null
    state.configured = false
    state.lastConnectedAt = null
    setStatus('idle')
    return ok(null)
  }

  async function invoke(channel: string, payload: unknown): Promise<Result> {
    try {
      deps.assertLicensed?.()
    } catch (e) {
      const err = licenseError(e)
      return fail(err.code, err.msg)
    }
    const c = client
    if (!c || !state.hostAddress) return fail('E_NOT_PAIRED', '尚未与主机配对')
    // disconnect / 会话过期后 token 为空：直接拒绝，避免带空 token 的读请求
    // 被主机判 401 再误判成「设备吊销」（v1.4 终审 S1）。
    if (!creds.token) return fail('E_HOST_UNREACHABLE', '当前未连接主机，请先重连')
    const result = await c.invoke(channel, payload)
    if (!result.ok && result.code === 'E_AUTH_FAILED') {
      // 8h 会话过期 / token 失效 → 重新登录，不销毁配对。
      markSessionExpired()
    } else if (!result.ok && result.code === 'E_NOT_PAIRED' && creds.secretHex) {
      // secret 已失效才是真吊销（主机侧 revoked_at / 设备被删）。
      markRevoked('与主机的连接已被吊销，请重新配对')
    }
    return result
  }

  async function restore(): Promise<Result> {
    // 授权门控（按机授权 v1.4 定案）：试用到期/无 LAN 授权的机器不得进入客户端模式。
    try {
      deps.assertLicensed?.()
    } catch {
      // 不删持久化设置：激活后重启仍可恢复客户端配置。但必须把内存态清成
      // idle + configured=false，否则 index.ts 的 onStateChanged 会把
      // clientModeActive 置 true，连本地单机业务都被 E_CLIENT_MODE 挡住（v1.4 终审 S4）。
      state.hostAddress = null
      state.deviceName = null
      state.deviceId = null
      state.configured = false
      setStatus('idle')
      return ok(null)
    }
    const address = deps.getSetting(SETTING_HOST_ADDRESS)
    const deviceName = deps.getSetting(SETTING_DEVICE_NAME)
    const deviceId = deps.getSetting(SETTING_DEVICE_ID)
    if (!address || !deviceName || !deviceId) return ok(null)
    state.hostAddress = address
    state.deviceName = deviceName
    state.deviceId = deviceId
    state.configured = true
    loadCredentials(address)
    if (!creds.secretHex || !creds.fingerprintHex) {
      // 凭据不可用（DPAPI 不可用/被清理）→ 维持 idle，等待重新配对。
      setStatus('idle')
      return ok(null)
    }
    if (!creds.token) {
      // token 为空/会话过期：不要带空 token 去 session:ping（会被 401 误判吊销），
      // 直接进 error 让用户重新输账号密码登录即可（v1.4 终审 S3）。
      markSessionExpired()
      return ok(null)
    }
    ensureClient()
    setStatus('connecting')
    const r = await client?.invoke('session:ping', { probe: true })
    if (r && r.ok) {
      state.lastConnectedAt = new Date(now()).toISOString()
      setStatus('connected')
      connectEvents()
      return ok(null)
    }
    // session:ping 失败可能已触发 onAuthFailed→markSessionExpired / markRevoked，
    // 状态已被改为 error/revoked，不要再覆写成 connecting（v1.4 终审 S2）。
    if (state.status === 'error' || state.status === 'revoked') return ok(null)
    setStatus('connecting', { code: r?.code ?? 'E_HOST_UNREACHABLE', msg: '与主机的连接已断开，正在自动重连…' })
    return ok(null)
  }

  function flushPendingSync(): void {
    try {
      client?.pending().flush()
    } catch (e) {
      log('warn', `pending flush failed: ${String(e)}`)
    }
  }

  // 初始状态：读取已保存配置（非敏感字段）用于 UI 预填。
  const savedAddress = deps.getSetting(SETTING_HOST_ADDRESS)
  if (savedAddress) {
    state.hostAddress = savedAddress
    state.deviceName = deps.getSetting(SETTING_DEVICE_NAME)
    state.deviceId = deps.getSetting(SETTING_DEVICE_ID)
    state.configured = Boolean(state.deviceName && state.deviceId)
  }

  return {
    status: snapshot,
    pairStart,
    reconnect,
    disconnect,
    forget,
    invoke,
    restore,
    flushPending: flushPendingSync,
    resendPending,
    pendingSize: () => client?.pending().size() ?? 0,
    onStateChanged(cb) {
      stateListeners.push(cb)
    }
  }
}
