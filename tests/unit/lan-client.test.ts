import 'reflect-metadata'
import { X509CertificateGenerator, cryptoProvider } from '@peculiar/x509'
import { describe, it, expect } from 'vitest'
import { createHash, createHmac, webcrypto } from 'node:crypto'
import { createLanClient, type LanClientDeps } from '../../src/main/host/lan-client'
import { signPayloadHex } from '../../src/main/host/auth'
import { createLanIpcHandlers } from '../../src/main/host/lan-transport'
import type { Server } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import { createServer as createHttpsServer } from 'node:https'
import { createServer } from 'node:http'

const secret = 'ab'.repeat(32)
const deps: LanClientDeps = {
  getBaseUrl: () => null,
  getSecretHex: () => secret,
  getFingerprintHex: () => null,
  getToken: () => 'tok-1',
  getDeviceId: () => 'dev-cli-1'
}

/** 最小自签证书（EC P-256，与 T5 cert.ts 同算法、同指纹口径 sha256(DER).hex）。
 *  @peculiar/x509 v3 注意：须 cryptoProvider.set(webcrypto) + X509CertificateGenerator.createSelfSigned；
 *  `new X509Certificate({...})` 构造式在 Node 22 下报 "Cannot get schema for 'Object' target"，
 *  且包无命名导出 `x509`（T5 cert.ts:9 `import { x509 }` 是同类问题，已向主会话汇报）。 */
async function selfSignedCert(): Promise<{ certPem: string; keyPem: string; fingerprintHex: string }> {
  cryptoProvider.set(webcrypto)
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  const cert = await X509CertificateGenerator.createSelfSigned({ name: 'CN=hx-test', keys, signingAlgorithm: algorithm })
  const certPem = cert.toString('pem')
  const fingerprintHex = createHash('sha256')
    .update(Buffer.from(certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64'))
    .digest('hex')
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
  const b64 = Buffer.from(pkcs8).toString('base64')
  const keyPem = ['-----BEGIN PRIVATE KEY-----', ...(b64.match(/.{1,64}/g) ?? []), '-----END PRIVATE KEY-----', ''].join('\n')
  return { certPem, keyPem, fingerprintHex }
}

describe('lan-client', () => {
  it('未配对（无 secret）→ E_NOT_PAIRED', async () => {
    const client = createLanClient({ ...deps, getSecretHex: () => null })
    const r = await client.invoke('sale:create', {})
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_NOT_PAIRED')
  })

  it('无 baseUrl → E_NOT_PAIRED', async () => {
    const client = createLanClient(deps)
    const r = await client.invoke('sale:create', {})
    expect(r.code).toBe('E_NOT_PAIRED')
  })

  it('HMAC 头构造与 T4 signPayloadHex 一致（本地 http server 校验）', async () => {
    let received: Record<string, string | string[] | undefined> = {}
    let rawBody = ''
    const srv: Server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        rawBody = Buffer.concat(chunks).toString('utf8')
        received = req.headers
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, code: 'OK', msg: '', data: 42 }))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const addr = srv.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const client = createLanClient({ ...deps, getBaseUrl: () => `http://127.0.0.1:${port}` })

    const r = await client.invoke('sale:create', { qty: 1 })
    expect(r.ok).toBe(true)
    expect((r.data as number)).toBe(42)
    expect(client.connected()).toBe(true)

    // 用同一函数重算签名比对——证明客户端头与主机验签（signPayloadHex）一致
    // 头名对齐 T5 server.ts §5.4：x-ts/x-nonce/x-device-id/x-sig/x-session-token/x-request-id
    const ts = Number(received['x-ts'])
    const nonce = String(received['x-nonce'])
    const device = String(received['x-device-id'])
    const expected = signPayloadHex(secret, device, ts, nonce, createHash('sha256').update(rawBody).digest('hex'))
    expect(received['x-sig']).toBe(expected)
    expect(received['x-session-token']).toBe('tok-1')
    const bodyObj = JSON.parse(rawBody) as { requestId: string; channel: string }
    expect(received['x-request-id']).toBe(bodyObj.requestId)
    expect(bodyObj.channel).toBe('sale:create')

    await new Promise<void>((r) => srv.close(() => r()))
  })

  it('连接失败 → E_HOST_UNREACHABLE 且 connected 翻转为 false', async () => {
    const states: boolean[] = []
    const client = createLanClient({
      ...deps,
      getBaseUrl: () => 'http://127.0.0.1:1', // 保留端口，必失败
      onStateChanged: (v) => states.push(v)
    })
    const r = await client.invoke('product:query', null)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_HOST_UNREACHABLE')
    expect(client.connected()).toBe(false)
  })

  it('lan-transport 薄壳透传 invoke', async () => {
    const calls: string[] = []
    const handlers = createLanIpcHandlers({
      invoke: async (ch) => {
        calls.push(ch)
        return { ok: true, code: 'OK', msg: '', data: null }
      },
      connected: () => true,
      setConnected: () => {}
    })
    await handlers.invoke('product:query', null)
    expect(calls).toEqual(['product:query'])
  })

  it('签名格式 sanity：ts 十进制秒、nonce 32B hex、HMAC-SHA256(secretHex 解码, "session"+deviceId+ts+nonce+bodySha256)', () => {
    const ts = 1700000000
    const nonce = 'cd'.repeat(32)
    const bodySha = createHash('sha256').update('{"x":1}').digest('hex')
    const sig = signPayloadHex(secret, 'dev-cli-1', ts, nonce, bodySha)
    const manual = createHmac('sha256', Buffer.from(secret, 'hex')).update(`sessiondev-cli-1${ts}${nonce}${bodySha}`).digest('hex')
    expect(sig).toBe(manual)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  describe('TLS 指纹 pinning（spec §5）', () => {
    it('https + 指纹未配置 → E_NOT_PAIRED（绝不放行）', async () => {
      const { certPem, keyPem } = await selfSignedCert()
      const srv: HttpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (_req, res) => res.end('{}'))
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
      const port = (srv.address() as { port: number }).port
      try {
        const client = createLanClient({ ...deps, getBaseUrl: () => `https://127.0.0.1:${port}`, getFingerprintHex: () => null })
        const r = await client.invoke('product:query', null)
        expect(r.ok).toBe(false)
        expect(r.code).toBe('E_NOT_PAIRED')
      } finally {
        await new Promise<void>((r) => srv.close(() => r()))
      }
    })

    it('https + 指纹不匹配 → E_FINGERPRINT_MISMATCH', async () => {
      const { certPem, keyPem } = await selfSignedCert()
      const srv: HttpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (_req, res) => res.end('{}'))
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
      const port = (srv.address() as { port: number }).port
      const wrong = 'ee'.repeat(32)
      try {
        const client = createLanClient({ ...deps, getBaseUrl: () => `https://127.0.0.1:${port}`, getFingerprintHex: () => wrong })
        const r = await client.invoke('product:query', null)
        expect(r.ok).toBe(false)
        expect(r.code).toBe('E_FINGERPRINT_MISMATCH')
      } finally {
        await new Promise<void>((r) => srv.close(() => r()))
      }
    })

    it('https + 指纹匹配 → 请求成功（pinning 生效）', async () => {
      const { certPem, keyPem, fingerprintHex } = await selfSignedCert()
      const srv: HttpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (_req, res) =>
        res.end(JSON.stringify({ ok: true, code: 'OK', msg: '', data: 7 }))
      )
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
      const port = (srv.address() as { port: number }).port
      try {
        const client = createLanClient({ ...deps, getBaseUrl: () => `https://127.0.0.1:${port}`, getFingerprintHex: () => fingerprintHex })
        const r = await client.invoke('product:query', null)
        expect(r.ok).toBe(true)
        expect(r.data).toBe(7)
      } finally {
        await new Promise<void>((r) => srv.close(() => r()))
      }
    })
  })
})
