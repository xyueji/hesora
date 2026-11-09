import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { createLanClient, type LanClientDeps } from '../../src/main/host/lan-client'
import { signPayloadHex } from '../../src/main/host/auth'
import { createLanIpcHandlers } from '../../src/main/host/lan-transport'
import type { Server } from 'node:http'
import { createServer } from 'node:http'

const secret = 'ab'.repeat(32)
const deps: LanClientDeps = {
  getBaseUrl: () => null,
  getSecretHex: () => secret,
  getToken: () => 'tok-1',
  getDeviceId: () => 'dev-cli-1'
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
    const ts = Number(received['x-host-ts'])
    const nonce = String(received['x-host-nonce'])
    const device = String(received['x-host-device'])
    const expected = signPayloadHex(secret, device, ts, nonce, createHash('sha256').update(rawBody).digest('hex'))
    expect(received['x-host-sig']).toBe(expected)
    expect(received['authorization']).toBe('Bearer tok-1')
    expect(JSON.parse(rawBody).channel).toBe('sale:create')

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
})
