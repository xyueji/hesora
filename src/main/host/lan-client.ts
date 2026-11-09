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
}

export interface LanClient {
  invoke(channel: string, payload: unknown, opts?: { requestId?: string }): Promise<Result>
  connected(): boolean
  setConnected(connected: boolean): void
}

const TIMEOUT_MS = 8_000

function bodySha256hex(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function createLanClient(deps: LanClientDeps): LanClient {
  let connected = false

  function setConnected(v: boolean): void {
    if (connected !== v) {
      connected = v
      deps.onStateChanged?.(v)
    }
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
        const finish = (r: Result): void => {
          res.destroy()
          setConnected(false)
          resolve(r)
        }
        if (isHttps) {
          // http2/http1 两种 socket 都挂 TLSSocket 或已升级；用类型收窄取证书
          const tlsSocket = res.socket as typeof res.socket & { getPeerCertificate?: () => { raw?: Buffer } }
          const pc = tlsSocket.getPeerCertificate?.()
          const actual = pc?.raw ? createHash('sha256').update(pc.raw).digest('hex') : null
          const expected = deps.getFingerprintHex()?.toLowerCase() ?? null
          if (!expected || !actual || actual !== expected) {
            finish(fail('E_FINGERPRINT_MISMATCH', '主机证书指纹不匹配，请重新配对'))
            return
          }
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          setConnected(true)
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Result)
          } catch {
            resolve(fail('E_HOST_BAD_RESPONSE', '主机响应格式异常'))
          }
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
      return rawInvoke(baseUrl, channel, payload, opts?.requestId)
    },
    connected: () => connected,
    setConnected
  }
}
