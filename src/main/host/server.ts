// v1.3 Task 5: 主机 HTTP/WS 服务装配（fastify 5 + 裸 ws）。
// spec §2.3 选型 D1：主机进程内嵌 HTTP/WS 服务；TLS 由 fastify https 选项承载，
// 证书来自 cert.ts（指纹 pinning 基座）。业务校验链（自外向内）：
//   ① 会话校验（X-Session-Token → hostAuth.validateSession）
//   ② HMAC 请求头校验（hostAuth.verifyRequest：时钟/签名/nonce 防重放）
//   ③ channel 路由防区（LOCAL/HOST_ONLY/未知，与 gateway 防御性双层一致）
//   ④ RBAC 前置（PERMISSION_MAP 有键 → canFor(session.userId, key)；无键放行，见下注释）
//   ⑤ gateway.handleRpc（幂等防重 + handler 分发）
// @fastify/ws 未发布/不可用（registry 404），故用裸 ws：真实 listen 时在 https server
// 'upgrade' 事件上挂 WebSocketServer({ noServer: true })，路由 /events 留给 T6。
import fastify, { type FastifyInstance } from 'fastify'
import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { PermissionKey } from '../../shared/permissions'
import { PERMISSION_MAP } from '../permissions-map'
import { LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES } from './host-protocol'
import type { createGateway } from './gateway'
import type { createPairingService } from './pairing'
import type { HostAuthService } from './auth'

export interface HostServerDeps {
  getDb: () => unknown
  handlers: Map<string, { channel: string; handler: (evt: unknown, payload: unknown, session?: unknown) => Promise<unknown> | unknown }>
  pairing: ReturnType<typeof createPairingService>
  hostAuth: HostAuthService
  gateway: ReturnType<typeof createGateway>
  /** RBAC 前置校验（T3 review I-4：PERMISSION_MAP 全量覆盖在此层执行）。 */
  canFor: (userId: number, key: PermissionKey) => boolean
  /** TLS 证书（ensureHostCertificate 产物）；测试 inject() 用不到，真实 listen 必须。 */
  tls?: { keyPem: string; certPem: string }
  /** 固定监听端口，默认 18650（spec §2.4）。 */
  port?: number
  /** 设备明文 secret 查询（HMAC 校验用）。配对确认时由接线层记录（见 deviceSecrets）。 */
  getDeviceSecret?: (deviceId: string) => string | null
  /** /auth/session（spec §5.5）：员工密码校验 + 会话/权限解出。接线层注入（userSvc 复用）。 */
  sessionLogin?: (username: string, password: string) => {
    user: { id: number; username: string; role: string; roleName?: string; permissions?: string[] }
    /** roleHas 解出的权限键集合（供客户端 UI 裁剪；HTTP 层 RBAC 仍走 canFor） */
    permissions: string[]
  } | null
  /** /pair/start 到达时回调接线层（把待确认码同步进 host:pairPending 列表）。缺省不回调。 */
  onPairRequest?: (entry: { code: string; deviceName: string; expiresAt: number }) => void
  log?: (level: 'info' | 'error' | 'warn', msg: string) => void
}

export interface HostServerHandle {
  port: number
  close(): Promise<void>
  /** T6 接管：WS hub 挂载点——每个新连接（upgrade 后）回调此 cb，参数为原生 ws 实例。 */
  onConnection(cb: (ws: unknown, req: IncomingMessage) => void): void
  /** T8 双审 A2：/pair/start 后登记/更新配对轮询结果（index.ts pairGrant/pairDeny 接线调用）。 */
  setPairResult(code: string, result: PairResultEntry): void
  /** T9：/pair/start HTTP 请求到达时回调（供 host:pairPending 展示）。 */
  setPairRequestCb(cb: (entry: { code: string; deviceName: string; expiresAt: number }) => void): void
  /** T8 双审 A3：按 deviceId 踢活跃 WS 连接（吊销设备用，close 4003）。
   *  依赖 index.ts 在 hub 创建后经 installKick 注入 hub.disconnectDevice。 */
  disconnectDevice(deviceId: string, closeCode?: number): number
  /** T8 双审 A3：hub 创建后注入踢连接实现（hub.disconnectDevice 绑定）。 */
  installKick(fn: (deviceId: string, closeCode?: number) => number): void
  /** T6 接管：底层 WebSocketServer 实例（不做多余封装）。listen 后才可用。 */
  readonly wss: WebSocketServer
  /** 真实监听（Electron 主进程启动时调用；测试用 inject 不调用）。 */
  listen(): Promise<number>
  /** 测试/调试：fastify inject（不开真实端口）。 */
  inject: FastifyInstance['inject']
}

const PAIR_RATE_LIMIT = 10          // spec §5.2：10 req/min per IP
const PAIR_RATE_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 10 * 1024 * 1024 // spec §4.1 内容长度上限 10MB

/** /pair/result 轮询结果（T8 双审 A2）：code → 状态快照。
 *  pending：/pair/start 登记等待店长确认；granted：店长允许，secret 一次性下发后作废；
 *  denied：店长拒绝（码已 discardPairing）；expired：码未知/过期。 */
interface PairResultEntry {
  status: 'pending' | 'granted' | 'denied'
  deviceName?: string
  deviceId?: string
  secretHex?: string
}

function isLocalChannel(channel: string): boolean {
  return LOCAL_CHANNEL_PREFIXES.some((p) => channel.startsWith(p))
}
function isHostOnlyChannel(channel: string): boolean {
  return HOST_ONLY_PREFIXES.some((p) => channel.startsWith(p))
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export async function createHostServer(deps: HostServerDeps): Promise<HostServerHandle> {
  const log = deps.log ?? (() => {})
  const getSecret = deps.getDeviceSecret ?? (() => null)
  // /pair/result 轮询结果表（仅内存；进程重启即失效——配对流程本就要重来）。
  const pairResults = new Map<string, PairResultEntry>()
  // 吊销踢连接：onConnection 闭包把 hub.disconnectDevice 绑到 deviceId 上（见 disconnectDevice 实现引用）。
  let hubKick: ((deviceId: string, closeCode?: number) => number) | null = null
  let pairRequestCb: ((entry: { code: string; deviceName: string; expiresAt: number }) => void) | null = null
  // /pair/start 限流：内存桶 key=IP，固定窗口近似（1min 重置）。3 台设备规模下
  // 精确性无关紧要，防暴力猜码即可（spec §5.2 实现裁定）。
  const rateBuckets = new Map<string, { windowStart: number; count: number }>()

  // HTTP/1.1 https server（fastify 5：仅传 https 选项默认即 node:https h1，不启用 h2；
  // 客户端 lan-client 用 node:https 发 h1，h2 server 会拒绝，故此处绝不能设 http2）。
  // inject() 路径不触发 TLS；真实 listen 需要 deps.tls，否则报错（防止裸 HTTP 上线）。
  const app: FastifyInstance = (
    deps.tls
      ? fastify({
          https: { key: deps.tls.keyPem, cert: deps.tls.certPem },
          bodyLimit: MAX_BODY_BYTES,
          logger: false
        })
      : fastify({
          bodyLimit: MAX_BODY_BYTES,
          logger: false
        })
  ) as FastifyInstance

  // HMAC 验签必须基于客户端的原始字节序列：fastify 默认 JSON.parse 后对象键序可能与
  // 客户端序列化不一致，JSON.stringify(body) 重算 bodySha 会 flaky 失败。此处对
  // application/json 保留 rawBody 字符串，verifyRequest 用原始体求 sha256；
  // rawBody 缺失（inject 直传对象等）时回退 JSON.stringify(body)。
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      ;(req as { rawBody?: string }).rawBody = body as string
      try {
        done(null, JSON.parse(body as string))
      } catch (e) {
        done(e as Error)
      }
    }
  )

  const wss = new WebSocketServer({ noServer: true })
  let connCb: ((ws: unknown, req: IncomingMessage) => void) | null = null
  wss.on('connection', (ws, req) => {
    connCb?.(ws, req)
  })

  // ---- /health/live：无认证（spec §4.2）----
  app.get('/health/live', async () => ({ alive: true }))

  // ---- /pair/start：配对端点，HMAC 会话之前，限流 10 req/min per IP ----
  app.post('/pair/start', async (req, reply) => {
    const ip = req.ip || 'unknown'
    const now = Date.now()
    const bucket = rateBuckets.get(ip)
    if (!bucket || now - bucket.windowStart >= PAIR_RATE_WINDOW_MS) {
      rateBuckets.set(ip, { windowStart: now, count: 1 })
    } else {
      bucket.count++
      if (bucket.count > PAIR_RATE_LIMIT) {
        log('warn', `pair/start rate limited: ${ip}`)
        void reply.code(429)
        return { ok: false, code: 'RATE_LIMIT', msg: '请求过于频繁，请稍后再试', data: null }
      }
    }
    const { deviceName } = (req.body ?? {}) as { deviceName?: unknown }
    if (typeof deviceName !== 'string' || deviceName.trim() === '') {
      return { ok: false, code: 'VALIDATION', msg: '设备名不能为空', data: null }
    }
    // 配对码生成走 pairing.startPairing；confirmPairing 需要主机店长物理确认（弹窗属 T8，
    // 本任务 console/通知占位——index.ts 接线处注释标明）。
    const started = deps.pairing.startPairing(deviceName.trim())
    log('info', `pairing request from ${ip}: device "${deviceName}" code ${started.code}（T8 弹窗确认占位）`)
    pairResults.set(started.code, { status: 'pending', deviceName: deviceName.trim() })
    pairRequestCb?.({ code: started.code, deviceName: deviceName.trim(), expiresAt: started.expiresAt })
    return {
      ok: true, code: 'OK', msg: '', data: { pending: true, pairingCode: started.code, expiresAt: started.expiresAt }
    }
  })

  // ---- /pair/result：客户端配对结果轮询（spec §5.2）。
  // 鉴权：配对码即认证（spec §4.2 /pair/start 行——配对确认前客户端尚无 secret，
  // 无从计算 HMAC，故与 /pair/start 同级免 HMAC；码本身 6 位随机 + 限流即是门槛）。
  // granted 时 secret 一次性下发并立即作废（重复轮询同码拿不到 secret）。
  app.get('/pair/result', async (req, reply) => {
    const code = String((req.query as Record<string, unknown>).code ?? '')
    if (!/^\d{4,12}$/.test(code)) {
      void reply.code(400)
      return { ok: false, code: 'VALIDATION', msg: '配对码无效', data: null }
    }
    // 与 /pair/start 同级限流（防止穷举配对码）。
    const ip = req.ip || 'unknown'
    const nowMs = Date.now()
    const bucket = rateBuckets.get(ip)
    if (!bucket || nowMs - bucket.windowStart >= PAIR_RATE_WINDOW_MS) {
      rateBuckets.set(ip, { windowStart: nowMs, count: 1 })
    } else {
      bucket.count++
      if (bucket.count > PAIR_RATE_LIMIT) {
        void reply.code(429)
        return { ok: false, code: 'RATE_LIMIT', msg: '请求过于频繁，请稍后再试', data: null }
      }
    }
    const entry = pairResults.get(code)
    if (!entry) {
      // 码未知或已过期：不区分细节，统一 expired（不泄漏码是否曾经存在）。
      return { ok: true, code: 'OK', msg: '', data: { status: 'expired' } }
    }
    if (entry.status === 'granted') {
      // 一次性下发：secret 随首个 granted 响应交出后作废（其余字段保留，status 仍 granted）。
      const data: Record<string, unknown> = {
        status: 'granted',
        deviceName: entry.deviceName,
        deviceId: entry.deviceId
      }
      if (entry.secretHex) {
        data.secret = entry.secretHex
        entry.secretHex = undefined
      }
      return { ok: true, code: 'OK', msg: '', data }
    }
    return {
      ok: true, code: 'OK', msg: '',
      data: entry.status === 'denied' ? { status: 'denied' } : { status: 'pending', deviceName: entry.deviceName }
    }
  })

  // ---- /rpc/:channel：业务 RPC 直通 ----
  app.post('/rpc/:channel', async (req, reply) => {
    const channel = String((req.params as { channel: string }).channel ?? '')
    const h = req.headers as Record<string, string | string[] | undefined>
    const hdr = (name: string): string => {
      const v = h[name]
      return Array.isArray(v) ? String(v[0]) : String(v ?? '')
    }

    // ① 会话校验
    const token = hdr('x-session-token')
    const sessionInfo = token ? deps.hostAuth.validateSession(token) : null
    if (!sessionInfo) {
      void reply.code(401)
      return { ok: false, code: 'E_AUTH_FAILED', msg: '会话无效或已过期', data: null }
    }
    const session = { deviceId: sessionInfo.deviceId, userId: sessionInfo.userId }

    // ② HMAC 请求头校验：ts/nonce/sig（body sha256，基于客户端原始字节序）
    const rawBody = (req as { rawBody?: string }).rawBody
    const bodyStr = typeof rawBody === 'string' ? rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null))
    const bodySha = sha256Hex(bodyStr)
    const deviceId = hdr('x-device-id')
    const ts = Number(hdr('x-ts'))
    const nonce = hdr('x-nonce')
    const sig = hdr('x-sig')
    if (!deviceId || !Number.isFinite(ts) || !nonce || !sig) {
      return { ok: false, code: 'E_AUTH_FAILED', msg: '缺少请求头（X-Device-Id/X-Ts/X-Nonce/X-Sig）', data: null }
    }
    const secret = getSecret(deviceId)
    if (!secret) {
      void reply.code(401)
      return { ok: false, code: 'E_AUTH_FAILED', msg: '设备未配对或已吊销', data: null }
    }
    const verified = deps.hostAuth.verifyRequest(secret, deviceId, ts, nonce, bodySha, sig)
    if (!verified.ok) {
      void reply.code(401)
      return { ok: false, code: verified.code, msg: verified.msg, data: null } // E_CLOCK_SKEW / E_AUTH_FAILED / E_REPLAY
    }

    // ③ channel 路由防区（与 gateway 防御性双层一致；这里先行拦截省去幂等登记）
    if (isLocalChannel(channel)) {
      return { ok: false, code: 'E_LOCAL_ONLY', msg: '该通道仅限本机调用', data: null }
    }
    if (isHostOnlyChannel(channel)) {
      return { ok: false, code: 'E_HOST_ONLY', msg: '该通道不支持局域网调用', data: null }
    }

    // ④ RBAC 前置：PERMISSION_MAP 有键 → canFor 不过 → NO_PERMISSION。
    //    无键放行理由：permissions-map.ts 头部约定「不在映射中的通道无需权限」——
    //    其中敏感通道（auth:*/license:*/trial:*/host:*）已被 LOCAL 前缀拦截；
    //    backup:*/sync:* 已被 HOST_ONLY 拦截；其余无键通道的 handler 内部另有
    //    can/canFor 二次判定兜底（handlers.ts 现状），双层之下无键放行可接受。
    const permKey = PERMISSION_MAP[channel]
    if (permKey && !deps.canFor(session.userId, permKey)) {
      return { ok: false, code: 'NO_PERMISSION', msg: '无操作权限', data: null }
    }

    // ⑤ 网关分发（幂等防重 + handler 调用）
    const bodyObj = (req.body ?? {}) as { requestId?: unknown; payload?: unknown }
    const requestId = hdr('x-request-id') || String(bodyObj.requestId ?? '')
    const result = await deps.gateway.handleRpc({ requestId, channel, payload: bodyObj.payload }, session)
    // ⑥ Result JSON：业务失败一律 HTTP 200 + ok=false（spec §4.1），不改写
    return result
  })

  // ---- /auth/session（spec §5.4/§5.5）：设备 HMAC 一步 + 员工登录 → session token ----
  // 鉴权与 /rpc 相同的 HMAC 头（X-Device-Id/X-Ts/X-Nonce/X-Sig）；成功 createSession
  // 返回 {token, user, permissions}；业务失败（密码错/未知员工）→ HTTP 200 + ok=false。
  app.post('/auth/session', async (req, reply) => {
    const h = req.headers as Record<string, string | string[] | undefined>
    const hdr = (name: string): string => {
      const v = h[name]
      return Array.isArray(v) ? String(v[0]) : String(v ?? '')
    }
    const rawBody = (req as { rawBody?: string }).rawBody
    const bodyStr = typeof rawBody === 'string' ? rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null))
    const bodySha = sha256Hex(bodyStr)
    const deviceId = hdr('x-device-id')
    const ts = Number(hdr('x-ts'))
    const nonce = hdr('x-nonce')
    const sig = hdr('x-sig')
    if (!deviceId || !Number.isFinite(ts) || !nonce || !sig) {
      void reply.code(401)
      return { ok: false, code: 'E_AUTH_FAILED', msg: '缺少请求头（X-Device-Id/X-Ts/X-Nonce/X-Sig）', data: null }
    }
    const secret = deps.getDeviceSecret?.(deviceId) ?? null
    if (!secret) {
      void reply.code(401)
      return { ok: false, code: 'E_AUTH_FAILED', msg: '设备未配对或已吊销', data: null }
    }
    const verified = deps.hostAuth.verifyRequest(secret, deviceId, ts, nonce, bodySha, sig)
    if (!verified.ok) {
      void reply.code(401)
      return { ok: false, code: verified.code, msg: verified.msg, data: null }
    }
    const bodyObj = (req.body ?? {}) as { employee?: unknown; password?: unknown }
    const username = typeof bodyObj.employee === 'string' ? bodyObj.employee.trim() : ''
    const password = typeof bodyObj.password === 'string' ? bodyObj.password : ''
    if (!username || !password || !deps.sessionLogin) {
      return { ok: false, code: 'VALIDATION', msg: !deps.sessionLogin ? '登录服务未就绪' : '员工名或密码不能为空', data: null }
    }
    const logged = deps.sessionLogin(username, password)
    if (!logged) {
      return { ok: false, code: 'E_LOGIN_FAILED', msg: '员工名或密码不正确', data: null }
    }
    // 校验密码通过 → 创建会话（hostAuth 内部校验 host_devices 未 revoked）
    let token: string
    try {
      token = deps.hostAuth.createSession(deviceId, logged.user.id).token
    } catch (e) {
      void reply.code(401)
      return { ok: false, code: 'E_AUTH_FAILED', msg: e instanceof Error && /revoked/.test(e.message) ? '设备已吊销' : '设备未配对', data: null }
    }
    return {
      ok: true, code: 'OK', msg: '',
      data: { token, user: logged.user, permissions: logged.permissions }
    }
  })

  const port = deps.port ?? 18650

  return {
    port,
    async close() {
      await new Promise<void>((res) => wss.close(() => res()))
      await app.close()
    },
    onConnection(cb) {
      connCb = cb
    },
    setPairResult(code, result) {
      pairResults.set(code, result)
    },
    setPairRequestCb(cb) {
      pairRequestCb = cb
    },
    disconnectDevice(deviceId, closeCode) {
      // hub 接线（index.ts）：installKick 注入 hub.disconnectDevice；
      // 未接线（无 hub）时无活跃连接可踢，返回 0。
      return hubKick ? hubKick(deviceId, closeCode) : 0
    },
    installKick(fn) {
      hubKick = fn
    },
    get wss() {
      return wss
    },
    inject: app.inject.bind(app),
    async listen() {
      if (!deps.tls) throw new Error('host server listen requires TLS cert (deps.tls)')
      // T6 接管：/events 升级在此挂——所有 upgrade 一律进 wss.handleUpgrade，路由/认证由 hub 做
      app.server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit('connection', ws, req))
      })
      await app.listen({ port, host: '0.0.0.0' })
      // port=0（测试临时端口）时返回 OS 实际分配端口；否则与配置端口一致。
      const addr = app.server.address()
      return typeof addr === 'object' && addr !== null ? addr.port : port
    }
  }
}
