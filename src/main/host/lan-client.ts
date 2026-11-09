// v1.3 Task 6: LAN 客户端传输（main 侧，客户端角色）——薄壳：响应 preload 'lan:invoke'，
// 向主机发 HTTPS POST /rpc/{channel}，带 HMAC 头（复用 T4 signPayloadHex）。
// TODO(T8/T9)：自签证书指纹校验（node:https rejectUnauthorized=false + 固定指纹 pinning），
// 当前先要求 baseUrl 为 https 且由调用方保证可信（开发期可用 http://host:port）。
// lanConnected 状态由本文件持有并广播 'lan:state-changed' 给 preload/renderer。
import { createHash, randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { signPayloadHex } from './auth'
import { fail, type Result } from '../../shared/result'

export interface LanClientDeps {
  /** 主机地址，如 https://192.168.1.10:37380 或 http://... （pairing 后写入） */
  getBaseUrl: () => string | null
  /** pairing 成功后保存的主机配对 secret（hex） */
  getSecretHex: () => string | null
  /** pairing 成功后获得的会话 token（放 Authorization 头） */
  getToken: () => string | null
  /** 本机 deviceId（pairing 时主机分配/协商） */
  getDeviceId: () => string
  onStateChanged?: (connected: boolean) => void
}

export interface LanClient {
  invoke(channel: string, payload: unknown): Promise<Result>
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

  function rawInvoke(baseUrl: string, channel: string, payload: unknown): Promise<Result> {
    const secretHex = deps.getSecretHex()
    if (!secretHex) return Promise.resolve(fail('E_NOT_PAIRED', '尚未与主机配对'))

    const body = JSON.stringify({ requestId: randomBytes(16).toString('hex'), channel, payload })
    const ts = Math.floor(Date.now() / 1000)
    const nonce = randomBytes(32).toString('hex')
    const sig = signPayloadHex(secretHex, deps.getDeviceId(), ts, nonce, bodySha256hex(body))
    const token = deps.getToken()

    const mod = baseUrl.startsWith('https:') ? httpsRequest : httpRequest
    return new Promise<Result>((resolve) => {
      const req = mod(
        `${baseUrl}/rpc/${channel}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-host-ts': String(ts),
            'x-host-nonce': nonce,
            'x-host-device': deps.getDeviceId(),
            'x-host-sig': sig,
            ...(token ? { authorization: `Bearer ${token}` } : {})
          },
          timeout: TIMEOUT_MS,
          // TODO(T8/T9): 自签证书指纹 pinning；当前 https 场景由上层决定是否放宽
          rejectUnauthorized: false
        },
        (res) => {
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
        }
      )
      req.on('timeout', () => {
        req.destroy()
        setConnected(false)
        resolve(fail('E_HOST_UNREACHABLE', '无法连接主机（超时）'))
      })
      req.on('error', () => {
        setConnected(false)
        resolve(fail('E_HOST_UNREACHABLE', '无法连接主机'))
      })
      req.end(body)
    })
  }

  return {
    async invoke(channel, payload): Promise<Result> {
      const baseUrl = deps.getBaseUrl()
      if (!baseUrl) return fail('E_NOT_PAIRED', '尚未与主机配对')
      return rawInvoke(baseUrl, channel, payload)
    },
    connected: () => connected,
    setConnected
  }
}
