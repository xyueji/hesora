// v1.4 客户端接线：客户端侧的主机事件 WS 连接（吊销检测）。
// 主机在 /events?token=... 提供事件流；设备被吊销时主机调用 hub.disconnectDevice(deviceId, 4003)
// → WS 以 close code 4003 断开 → 客户端把状态切到 'revoked' 并广播给渲染层。
// TLS 策略与 lan-client 一致：自签证书需 rejectUnauthorized=false 放行握手，但**必须**核对
// peerCertificate.raw 的 sha256hex 与主机下发的指纹一致（不采信 TOFU）。
// 'ws' 采用动态 import（客户端接线模块被 main 顶层 import，懒加载避免拖慢启动）。
import { createHash } from 'node:crypto'
import type { WebSocket as WebSocketType } from 'ws'

export interface HostEventsClientDeps {
  /** 主机地址（https://host:18650），null = 未配置。 */
  getBaseUrl: () => string | null
  /** 会话令牌（/auth/session 下发）。 */
  getToken: () => string | null
  /** 主机自签证书指纹 sha256(DER).hex。 */
  getFingerprintHex: () => string | null
  /** 主机吊销本机（close 4003/4001）时回调。 */
  onRevoked: (reason: string) => void
  log?: (msg: string) => void
  /** 断线重连间隔（测试可缩短）。 */
  reconnectDelayMs?: number
}

export interface HostEventsClient {
  connect(): void
  close(): void
}

/** ws 客户端实例上取底层 TLS socket（内部字段，类型未公开 → unknown 收窄）。 */
interface PeerSocketLike {
  getPeerCertificate?: () => { raw?: Buffer } | undefined
}
interface WsWithSocket {
  _socket?: PeerSocketLike
}

const CLOSE_REVOKED = 4003
const CLOSE_UNAUTHORIZED = 4001

export function createHostEventsClient(deps: HostEventsClientDeps): HostEventsClient {
  const reconnectDelayMs = deps.reconnectDelayMs ?? 5_000
  const log = deps.log ?? (() => {})
  let socket: WebSocketType | null = null
  let closedByUs = false
  let revoked = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function eventsUrl(): string | null {
    const base = deps.getBaseUrl()
    const token = deps.getToken()
    if (!base || !token) return null
    const u = new URL(base)
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:'
    u.pathname = '/events'
    u.search = `?token=${encodeURIComponent(token)}`
    return u.toString()
  }

  function checkFingerprint(ws: WebSocketType): boolean {
    const expected = deps.getFingerprintHex()
    if (!expected) return false
    const peer = (ws as unknown as WsWithSocket)._socket
    const cert = peer?.getPeerCertificate?.()
    if (!cert?.raw) return false
    const actual = createHash('sha256').update(cert.raw).digest('hex')
    return actual === expected.toLowerCase()
  }

  function scheduleRetry(): void {
    if (closedByUs || revoked) return
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = null
      void connect()
    }, reconnectDelayMs)
    retryTimer.unref?.()
  }

  async function connect(): Promise<void> {
    if (closedByUs || revoked) return
    const url = eventsUrl()
    if (!url) return
    clearRetry()
    let Ctor: typeof import('ws').WebSocket
    try {
      const mod = await import('ws')
      Ctor = mod.WebSocket ?? (mod.default as unknown as typeof import('ws').WebSocket)
    } catch (e) {
      log(`ws module unavailable: ${String(e)}`)
      return
    }
    if (closedByUs || revoked) return
    try {
      socket = new Ctor(url, {
        // 配对后已知主机指纹：握手放行自签证书，随后逐连接核对指纹。
        rejectUnauthorized: false,
        handshakeTimeout: 8_000
      })
    } catch (e) {
      log(`connect failed: ${String(e)}`)
      scheduleRetry()
      return
    }
    const ws = socket
    ws.on('open', () => {
      if (!checkFingerprint(ws)) {
        log('fingerprint mismatch — closing host events connection')
        revoked = true
        deps.onRevoked('主机证书指纹不匹配，已断开连接')
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        return
      }
      log('host events connected')
    })
    ws.on('message', () => {
      // 事件内容本轮不消费（客户端渲染层只关心连接/吊销状态）。
    })
    ws.on('error', (e: Error) => {
      log(`socket error: ${e.message}`)
    })
    ws.on('close', (code: number) => {
      socket = null
      if (closedByUs) return
      if (code === CLOSE_REVOKED) {
        revoked = true
        deps.onRevoked('与主机的连接已被吊销，请重新配对')
        return
      }
      if (code === CLOSE_UNAUTHORIZED) {
        revoked = true
        deps.onRevoked('主机拒绝了本机会话，请重新配对')
        return
      }
      log(`host events closed (code=${code}), retrying`)
      scheduleRetry()
    })
  }

  function close(): void {
    closedByUs = true
    clearRetry()
    try {
      socket?.close()
    } catch {
      /* ignore */
    }
    socket = null
  }

  return { connect: () => void connect(), close }
}
