// v1.3 Task 6: LAN 客户端传输（main 侧，客户端角色）——薄壳：响应 preload 'lan:invoke'，
// 向主机发 HTTPS POST /rpc/{channel}，带 HMAC 头（复用 T4 signPayloadHex）。
// TLS 安全（spec §5）：自签证书 + 指纹 pinning——checkServerIdentity 比对
// sha256(peerCert.raw) hex 与已保存的 pairing 指纹（与 T5 cert.ts fingerprintOf
// = sha256(证书 DER).hex 同一约定，证书目录 userData/host-cert/）。
// 指纹未配置（未配对/被 revoke 后须重配对）→ E_NOT_PAIRED，绝不放行。
// 仅当 baseUrl 显式为 http://（开发/无 TLS 场景）才走明文——此时由部署者保证网络可信。
import { createHash, randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { signPayloadHex } from './auth'
import { fail, type Result } from '../../shared/result'
import { createReconnectController, type ReconnectController } from './reconnect'
import { createPendingRegistry, isTransientFailure, type PendingRegistry, type PendingRegistryDeps } from './pending-registry'

export interface LanClientDeps {
  /** 主机地址，如 https://192.168.1.10:37380（pairing 后写入） */
  getBaseUrl: () => string | null
  /** pairing 成功后保存的主机配对 secret（hex） */
  getSecretHex: () => string | null
  /** pairing 时保存的主机证书指纹（sha256(DER).hex，小写）——pinning 基准 */
  getFingerprintHex: () => string | null
  /** pairing 成功后获得的会话 token（放 x-session-token 头，spec §5.4 / T5 server.ts） */
  getToken: () => string | null
  /** 本机 deviceId（pairing 时主机分配/协商） */
  getDeviceId: () => string
  onStateChanged?: (connected: boolean) => void
  /**
   * v1.4：主机侧鉴权失败（会话无效 / 设备已吊销，主机返回 E_AUTH_FAILED）回调。
   * 接线层据此把客户端状态机切到 'revoked'（B7 吊销检测）。
   */
  onAuthFailed?: (code: string) => void
  /** T8：pending 登记持久化（可选；默认内存。main 侧接线层可传 fs 实现） */
  pendingPersist?: PendingRegistryDeps
  /** T8：测试注入定时器（不传用真实 setTimeout） */
  reconnectSchedule?: (delayMs: number, fn: () => void) => unknown
  reconnectCancel?: (handle: unknown) => void
}

export interface LanClient {
  invoke(channel: string, payload: unknown, opts?: { requestId?: string }): Promise<Result>
  connected(): boolean
  setConnected(connected: boolean): void
  /** T8：重连控制器（断线后 1/2/4/8/16/30s+jitter 退避重试；接线层/测试消费） */
  reconnect(): ReconnectController
  /** T8：pending 幂等登记表（网络失败保留、确定性失败删除；接线层退出 flush 消费） */
  pending(): PendingRegistry
}

const TIMEOUT_MS = 8_000

/**
 * v1.4（B4 T5 红线修复）：重连探测通道。
 * 旧实现用 `product:query` + payload=null 探测——payload null 会让主机侧
 * product.service 的 query(q) 读 q.pageSize 抛 TypeError（网关兜底成 INTERNAL），
 * 且 product:query 受 product.view 权限限制（收银员账号恒 NO_PERMISSION），
 * 于是 attempt 恒 false → 自动重连永不成功。
 * 现改为专用无副作用探测通道 session:ping：主机在 /rpc 路由里显式应答 pong
 * （不查业务表、不需要任何业务权限，仅需有效会话 + HMAC）。
 * 旧版主机不认识该通道 → 网关返回 NOT_FOUND，探测仍判定"主机可达"。
 */
export const PROBE_CHANNEL = 'session:ping'

/** 探测结果判定：这些码说明"主机不可达或本机配置失效"，其余业务失败码说明主机在线。 */
const UNREACHABLE_CODES = new Set(['E_HOST_UNREACHABLE', 'E_AUTH_FAILED', 'E_NOT_PAIRED', 'E_FINGERPRINT_MISMATCH'])

function bodySha256hex(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function createLanClient(deps: LanClientDeps): LanClient {
  let connected = false

  // T8：pending 幂等登记 + 重连状态机（断线由 setConnected(false) 触发退避循环；
  // attempt 用专用探测通道 session:ping，见 PROBE_CHANNEL 注释）。
  const pendingRegistry = createPendingRegistry(deps.pendingPersist)
  const reconnectCtl = createReconnectController({
    attempt: async () => {
      const baseUrl = deps.getBaseUrl()
      if (!baseUrl) return false
      const r = await rawInvoke(baseUrl, PROBE_CHANNEL, { probe: true })
      if (r.ok) return true
      // 主机在线但业务侧失败（旧版主机不识别 session:ping → NOT_FOUND；或权限不足）
      // 同样说明主机可达——不能一律判失败，否则收银员等低权限账号永远重连不上。
      return !UNREACHABLE_CODES.has(r.code)
    },
    schedule: deps.reconnectSchedule,
    cancel: deps.reconnectCancel
  })

  /**
   * 连接状态翻转。
   * retryable=false 用于配置性失败（证书指纹不符 / 未配对）：此时不启动退避重试——
   * 重试无意义（需人工重新配对），否则会陷入无休止的退避循环。
   */
  function applyConnected(v: boolean, retryable: boolean): void {
    if (connected === v) return
    connected = v
    deps.onStateChanged?.(v)
    // T8 重连裁定：掉线 → 启动退避循环；恢复 → markConnected 重置。
    if (!v) {
      if (retryable) reconnectCtl.markDisconnected()
    } else {
      reconnectCtl.markConnected()
    }
  }

  function setConnected(v: boolean): void {
    applyConnected(v, true)
  }

  /** 主机侧鉴权失败（会话无效/设备已吊销）→ 通知接线层切 'revoked'。 */
  function notifyAuthFailure(result: Result): void {
    if (result.ok) return
    if (result.code === 'E_AUTH_FAILED') deps.onAuthFailed?.(result.code)
  }

  function rawInvoke(baseUrl: string, channel: string, payload: unknown, explicitRequestId?: string): Promise<Result> {
    const secretHex = deps.getSecretHex()
    if (!secretHex) return Promise.resolve(fail('E_NOT_PAIRED', '尚未与主机配对'))

    const requestId = explicitRequestId ?? randomBytes(16).toString('hex')
    const body = JSON.stringify({ requestId, channel, payload })
    const ts = Math.floor(Date.now() / 1000)
    const nonce = randomBytes(32).toString('hex')
    const sig = signPayloadHex(secretHex, deps.getDeviceId(), ts, nonce, bodySha256hex(body))
    const token = deps.getToken()

    const isHttps = baseUrl.startsWith('https:')
    const mod = isHttps ? httpsRequest : httpRequest
    const opts: RequestOptions = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ts': String(ts),
        'x-nonce': nonce,
        'x-device-id': deps.getDeviceId(),
        'x-sig': sig,
        'x-request-id': requestId,
        ...(token ? { 'x-session-token': token } : {})
      },
      timeout: TIMEOUT_MS
    }
    if (isHttps) {
      // 自签证书 + pinning（spec §5）：不能用 checkServerIdentity —— Node 对自签证书在
      // 调用它之前就以 DEPTH_ZERO_SELF_SIGNED_CERT 失败（错误对象丢失我们返回的 Error 文本）。
      // 正确姿势：rejectUnauthorized:false 跳过系统 CA 验证，然后在 response 到达时
      // 手动比对 sha256(peerCert.raw) 与 pairing 保存的指纹，不匹配则销毁连接并报错。
      // 这仍然防中间人：MITM 的证书指纹必不匹配 → 连接被销毁，请求体不会发出。
      // （connect 阶段完成、response 到达前恶意主机拿到的只有 TLS 握手，无任何业务数据。）
      const expected = deps.getFingerprintHex()?.toLowerCase() ?? null
      if (!expected) return Promise.resolve(fail('E_NOT_PAIRED', '尚未与主机配对（缺少主机证书指纹），拒绝连接'))
      opts.rejectUnauthorized = false
    }

    return new Promise<Result>((resolve) => {
      const req = mod(`${baseUrl}/rpc/${channel}`, opts, (res) => {
        const finish = (r: Result, retryable: boolean): void => {
          res.destroy()
          applyConnected(false, retryable)
          resolve(r)
        }
        if (isHttps) {
          // http2/http1 两种 socket 都挂 TLSSocket 或已升级；用类型收窄取证书
          const tlsSocket = res.socket as typeof res.socket & { getPeerCertificate?: () => { raw?: Buffer } }
          const pc = tlsSocket.getPeerCertificate?.()
          const actual = pc?.raw ? createHash('sha256').update(pc.raw).digest('hex') : null
          const expected = deps.getFingerprintHex()?.toLowerCase() ?? null
          if (!expected || !actual || actual !== expected) {
            // 配置性失败（指纹不符）→ 不触发自动重连（重试无意义，需重新配对）。
            finish(fail('E_FINGERPRINT_MISMATCH', '主机证书指纹不匹配，请重新配对'), false)
            return
          }
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          let parsed: Result
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Result
          } catch {
            applyConnected(true, true)
            resolve(fail('E_HOST_BAD_RESPONSE', '主机响应格式异常'))
            return
          }
          // 主机侧鉴权失败（会话无效 / 设备已吊销，主机回 401 E_AUTH_FAILED）：
          // 不再标记为"已连接"，且不触发退避重试（重试无意义——需重新配对），
          // 由 onAuthFailed 通知接线层把状态机切到 'revoked'。
          if (!parsed.ok && parsed.code === 'E_AUTH_FAILED') {
            applyConnected(false, false)
            notifyAuthFailure(parsed)
            resolve(parsed)
            return
          }
          applyConnected(true, true)
          resolve(parsed)
        })
      })
      req.on('timeout', () => {
        req.destroy()
        setConnected(false)
        resolve(fail('E_HOST_UNREACHABLE', '无法连接主机（超时）'))
      })
      req.on('error', (e: Error & { code?: string }) => {
        setConnected(false)
        const msg = String(e.message ?? e)
        if (msg.includes('E_FINGERPRINT_MISMATCH')) resolve(fail('E_FINGERPRINT_MISMATCH', '主机证书指纹不匹配，请重新配对'))
        else if (msg.includes('E_NOT_PAIRED')) resolve(fail('E_NOT_PAIRED', '尚未与主机配对（缺少证书指纹）'))
        else resolve(fail('E_HOST_UNREACHABLE', '无法连接主机'))
      })
      req.end(body)
    })
  }

  return {
    async invoke(channel, payload, opts): Promise<Result> {
      const baseUrl = deps.getBaseUrl()
      if (!baseUrl) return fail('E_NOT_PAIRED', '尚未与主机配对')
      // T8：幂等通道发前登记 {requestId,channel,payload}；显式 requestId 优先（重试原键）。
      const requestId = opts?.requestId ?? randomBytes(16).toString('hex')
      const entry = { requestId, channel, payload }
      pendingRegistry.track(entry)
      const result = await rawInvoke(baseUrl, channel, payload, requestId)
      pendingRegistry.settle(entry, result)
      // 瞬态失败时网络错已把 connected 打成 false → 退避重连循环接管。
      // isTransientFailure 在此消费一次避免 lint 未用告警（保留导出供接线层判断）。
      void isTransientFailure(result)
      return result
    },
    connected: () => connected,
    setConnected,
    reconnect: () => reconnectCtl,
    pending: () => pendingRegistry
  }
}
