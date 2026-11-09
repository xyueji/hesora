import { rmSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import * as https from 'node:https'
import { openMemDb } from '../helpers/mem-db'
import { createHostServer } from '../../src/main/host/server'
import { createGateway } from '../../src/main/host/gateway'
import { createHostAuthService } from '../../src/main/host/auth'
import { createPairingService } from '../../src/main/host/pairing'
import { PERMISSION_MAP } from '../../src/main/permissions-map'
import { createSaleService } from "../../src/main/services/sale/sale.service"
import type { IpcHandler } from '../../src/shared/result'
import type { DB } from '../../src/main/db'

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const SECRET_HEX = 'aa'.repeat(32)

let fxCaptured: { adminId: number; cashierId: number } = { adminId: 1, cashierId: 2 }

interface Fixture {
  app: Awaited<ReturnType<typeof createHostServer>>
  db: ReturnType<typeof openMemDb>
  hostAuth: ReturnType<typeof createHostAuthService>
  setNow: (n: number) => void
  getNow: () => number
  adminId: number
  cashierId: number
}

let fx: Fixture
const cleanups: string[] = []

async function setupFixture(handlerOverrides: Record<string, IpcHandler> = {}): Promise<Fixture> {
  const db = openMemDb()
  let now = 1_800_000_000_000
  const clock = () => now
  const hostAuth = createHostAuthService(db as unknown as import('better-sqlite3').Database, { clock })
  const pairing = createPairingService(db as unknown as import('better-sqlite3').Database, { clock })
  const handlers = new Map(Object.entries(handlerOverrides).map(([channel, handler]) => [channel, { channel, handler }]))
  const gw = createGateway({ getDb: () => db as unknown as DB, handlers })
  fxCaptured = { adminId: 0, cashierId: 0 }
  const canFor = (userId: number, key: string): boolean => {
    // 测试用内存 RBAC：user 1=admin 全权，user 2=cashier 仅 inventory.view
    if (userId === fxCaptured.adminId) return true
    return userId === fxCaptured.cashierId && key === 'inventory.view'
  }
  const app = await createHostServer({
    getDb: () => db as unknown as DB,
    handlers,
    pairing,
    hostAuth,
    gateway: gw,
    canFor: canFor as never,
    getDeviceSecret: (id) => (id === 'dev-1' ? SECRET_HEX : null),
    log: () => {}
  })
  // 造已配对设备 + 会话
  db.prepare('INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)').run(
    'dev-1', 'd1', SECRET_HEX, new Date(now).toISOString()
  )
  db.prepare('INSERT INTO "user" (username, password_hash, role) VALUES (?,?,?)').run('admin', 'x'.repeat(20), 'admin')
  db.prepare('INSERT INTO "user" (username, password_hash, role) VALUES (?,?,?)').run('cashier', 'x'.repeat(20), 'cashier')
  const adminId = (db.prepare('SELECT id FROM "user" WHERE username=?').get('admin') as { id: number }).id
  const cashierId = (db.prepare('SELECT id FROM "user" WHERE username=?').get('cashier') as { id: number }).id
  fxCaptured = { adminId, cashierId }
  hostAuth.createSession('dev-1', adminId)
  return { app, db, hostAuth, setNow: (n: number) => { now = n }, getNow: () => now, adminId, cashierId }
}

function rpcHeaders(app: Fixture, body: string, over: Partial<{
  deviceId: string; ts: number; nonce: string; sig: string; token: string; requestId: string
}> = {}): Record<string, string> {
  const ts = over.ts ?? Math.floor(app.getNow() / 1000)
  const nonce = over.nonce ?? randomBytes(16).toString('hex')
  const bodySha = sha256hex(body)
  const sig = over.sig ?? app.hostAuth.signPayload(SECRET_HEX, over.deviceId ?? 'dev-1', ts, nonce, bodySha)
  const h: Record<string, string> = {
    'x-device-id': over.deviceId ?? 'dev-1',
    'x-ts': String(ts),
    'x-nonce': nonce,
    'x-sig': sig,
    'x-request-id': over.requestId ?? 'req-1',
    'content-type': 'application/json'
  }
  if (over.token !== null) h['x-session-token'] = over.token ?? tokenOf(app)
  return h
}

let cachedToken: string | null = null
function tokenOf(app: Fixture): string {
  if (!cachedToken) cachedToken = app.hostAuth.createSession('dev-1', 1).token
  return cachedToken
}

beforeEach(async () => {
  cachedToken = null
  fx = await setupFixture({
    'product:query': (_e, p) => ({ got: p }),
    'doc:reverse': () => ({ reversed: true })
  })
})
afterEach(async () => {
  await fx.app.close()
  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
  cleanups.length = 0
})

describe('host server /rpc', () => {
  it('valid HMAC headers + valid session → Result ok', async () => {
    const body = JSON.stringify({ requestId: 'r1', channel: 'product:query', payload: { q: 'x' } })
    const res = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: body, headers: rpcHeaders(fx, body) })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.ok).toBe(true)
    expect(json.data).toEqual({ got: { q: 'x' } })
  })

  it('missing/invalid session token → E_AUTH_FAILED', async () => {
    const body = JSON.stringify({ requestId: 'r1', channel: 'product:query', payload: null })
    const res1 = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: body, headers: rpcHeaders(fx, body, { token: '' }) })
    expect(res1.json().code).toBe('E_AUTH_FAILED')
    const res2 = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: body, headers: rpcHeaders(fx, body, { token: 'bogus-token' }) })
    expect(res2.json().code).toBe('E_AUTH_FAILED')
  })

  it('bad signature → E_AUTH_FAILED; replayed nonce → E_REPLAY; skewed ts → E_CLOCK_SKEW', async () => {
    const body = JSON.stringify({ requestId: 'r1', channel: 'product:query', payload: null })
    const bad = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: body, headers: rpcHeaders(fx, body, { sig: '0'.repeat(64) }) })
    expect(bad.json().code).toBe('E_AUTH_FAILED')

    const replayBody = JSON.stringify({ requestId: 'r2', channel: 'product:query', payload: null })
    const replayNonce = randomBytes(16).toString('hex') // 重放=同 nonce 同 sig 同 body
    const okRes = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: replayBody, headers: rpcHeaders(fx, replayBody, { nonce: replayNonce }) })
    expect(okRes.json().ok).toBe(true)
    const replay = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: replayBody, headers: rpcHeaders(fx, replayBody, { nonce: replayNonce }) })
    expect(replay.json().code).toBe('E_REPLAY')

    const skewTs = Math.floor(fx.getNow() / 1000) - 121
    const skewBody = JSON.stringify({ requestId: 'r3', channel: 'product:query', payload: null })
    const skew = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: skewBody, headers: rpcHeaders(fx, skewBody, { ts: skewTs }) })
    expect(skew.json().code).toBe('E_CLOCK_SKEW')
  })

  it('LOCAL channel → E_LOCAL_ONLY; backup: → E_HOST_ONLY; unknown → NOT_FOUND (404 semantic via Result code)', async () => {
    for (const [channel, code] of [['license:check', 'E_LOCAL_ONLY'], ['auth:login', 'E_LOCAL_ONLY'], ['backup:now', 'E_HOST_ONLY'], ['sync:now', 'E_HOST_ONLY'], ['nope:thing', 'NOT_FOUND']] as const) {
      const body = JSON.stringify({ requestId: 'r-' + channel, channel, payload: null })
      const res = await fx.app.inject({ method: 'POST', url: `/rpc/${channel}`, payload: body, headers: rpcHeaders(fx, body) })
      expect(res.json().code).toBe(code)
    }
  })

  it('RBAC precheck: PERMISSION_MAP key + canFor false → NO_PERMISSION (cashier cannot doc:reverse)', async () => {
    expect(PERMISSION_MAP['doc:reverse']).toBe('doc.reverse')
    const cashierToken = fx.hostAuth.createSession('dev-1', fx.cashierId).token
    const body = JSON.stringify({ requestId: 'r-rbac', channel: 'doc:reverse', payload: { id: 1 } })
    const res = await fx.app.inject({ method: 'POST', url: '/rpc/doc:reverse', payload: body, headers: rpcHeaders(fx, body, { token: cashierToken }) })
    expect(res.json().code).toBe('NO_PERMISSION')
  })

  it('RBAC pass-through: channel without PERMISSION_MAP key is allowed (no key → no precheck)', async () => {
    const cashierToken = fx.hostAuth.createSession('dev-1', fx.cashierId).token
    const body = JSON.stringify({ requestId: 'r-nk', channel: 'unmapped:channel', payload: null })
    const res = await fx.app.inject({ method: 'POST', url: '/rpc/unmapped:channel', payload: body, headers: rpcHeaders(fx, body, { token: cashierToken }) })
    expect(res.json().code).toBe('NOT_FOUND') // gateway 里未知通道 NOT_FOUND，而不是 NO_PERMISSION —— 证明未做前置拦截
  })

  it('idempotency: 100 replays same X-Request-Id → same result, stock moves once (real saleService)', async () => {
    const db = openMemDb()
    db.prepare("INSERT INTO warehouse (id, code, name) VALUES (1, 'W', 'w')").run()
    db.prepare("INSERT INTO product (id, code, name, retail_price, trade_price, purchase_price, base_unit) VALUES (1, 'P1', 'p', 1, 1, 1, '件')").run()
    db.prepare("INSERT INTO inventory (product_id, warehouse_id, batch_no, qty, moving_cost) VALUES (1, 1, '', 1, 1)").run()
    const saleSvc = createSaleService(db as unknown as DB)
    let now = 1_800_000_000_000
    const hostAuth = createHostAuthService(db as unknown as import('better-sqlite3').Database, { clock: () => now })
    const pairing = createPairingService(db as unknown as import('better-sqlite3').Database, { clock: () => now })
    const handlers = new Map([['sale:create', { channel: 'sale:create', handler: ((_e: unknown, p: unknown) => saleSvc.create(p as never)) as IpcHandler }]])
    const gw = createGateway({ getDb: () => db as unknown as DB, handlers })
    const app = await createHostServer({
      getDb: () => db as unknown as DB, handlers, pairing, hostAuth, gateway: gw,
      canFor: () => true, getDeviceSecret: (id) => (id === 'dev-1' ? SECRET_HEX : null), log: () => {}
    })
    db.prepare('INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)').run(
      'dev-1', 'd1', SECRET_HEX, new Date(now).toISOString()
    )
    db.prepare("INSERT INTO \"user\" (id, username, password_hash, role) VALUES (1, 'admin', ?, 'admin')").run('x'.repeat(20))
    const { token } = hostAuth.createSession('dev-1', 1)
    const payload = { warehouse_id: 1, items: [{ product_id: 1, qty: 1, price: 1 }] }
    const body = JSON.stringify({ requestId: 'sale-1', channel: 'sale:create', payload })
    const hdrs: Record<string, string> = {
      'x-device-id': 'dev-1', 'x-ts': String(Math.floor(now / 1000)),
      'x-nonce': '',
      'x-sig': '',
      'x-session-token': token,
      'content-type': 'application/json'
    }
    const nonce = randomBytes(16).toString('hex')
    hdrs['x-nonce'] = nonce
    hdrs['x-sig'] = hostAuth.signPayload(SECRET_HEX, 'dev-1', Math.floor(now / 1000), nonce, sha256hex(body))
    const first = await app.inject({ method: 'POST', url: '/rpc/sale:create', payload: body, headers: hdrs })
    expect(first.json().ok).toBe(true)
    for (let i = 0; i < 100; i++) {
      // 重试语义：新 nonce（HMAC 防重放按 nonce 拦截），相同 X-Request-Id → 网关幂等返回同一结果
      const retryNonce = randomBytes(16).toString('hex')
      hdrs['x-nonce'] = retryNonce
      hdrs['x-sig'] = hostAuth.signPayload(SECRET_HEX, 'dev-1', Math.floor(now / 1000), retryNonce, sha256hex(body))
      const r = await app.inject({ method: 'POST', url: '/rpc/sale:create', payload: body, headers: hdrs })
      expect(r.json()).toEqual(first.json())
    }
    const qty = db.prepare('SELECT qty FROM inventory WHERE product_id=1 AND warehouse_id=1').get() as { qty: number }
    expect(qty.qty).toBe(0)
    await app.close()
  })

  it('/pair/start rate limit: 11th request within a minute → 429 RATE_LIMIT', async () => {
    let last
    for (let i = 0; i < 11; i++) {
      last = await fx.app.inject({ method: 'POST', url: '/pair/start', payload: { deviceName: `dev-${i}` }, remoteAddress: '10.0.0.9' })
    }
    expect(last!.statusCode).toBe(429)
    expect(last!.json().code).toBe('RATE_LIMIT')
  })

  it('/pair/start valid code path: startPairing → confirm (host side) → returns pending semantics', async () => {
    // 占位：confirmPairing 的 UI 弹窗属 T8；此处验证端点本身工作并返回可确认的形态
    const res = await fx.app.inject({ method: 'POST', url: '/pair/start', payload: { deviceName: 'front-counter' }, remoteAddress: '10.0.0.2' })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.ok).toBe(true)
    expect(json.data.pairingCode).toMatch(/^\d{6}$/)
  })
})

describe('host server misc', () => {
  it('GET /health/live → {alive:true} without auth', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/health/live' })
    expect(res.json()).toEqual({ alive: true })
  })

  it('exposes onConnection hook for T6 (WS hub mount point)', async () => {
    const conns: unknown[] = []
    fx.app.onConnection((ws) => { conns.push(ws) })
    expect(typeof fx.app.onConnection).toBe('function')
  })

  it('key-order robustness: raw body preserved (client byte order ≠ re-stringified)', async () => {
    // 客户端故意用与 JSON.stringify 不同的键序序列化；服务端必须用原始字节验签
    const body = '{"payload":{"b":2,"a":1},"requestId":"r-order","channel":"product:query"}'
    const res = await fx.app.inject({ method: 'POST', url: '/rpc/product:query', payload: body, headers: rpcHeaders(fx, body) })
    expect(res.json().ok).toBe(true)
  })

  it('real HTTP/1.1 client (node:https) against listened TLS server → 200/401 path works', async () => {
    const { ensureHostCertificate } = await import('../../src/main/host/cert')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const certDir = mkdtempSync(join(tmpdir(), 'hostsrv-test-'))
    cleanups.push(certDir)
    const cert = await ensureHostCertificate(certDir)
    const app = await createHostServer({
      getDb: () => fx.db as unknown as DB,
      handlers: new Map([['product:query', { channel: 'product:query', handler: (_e, p) => ({ got: p }) }]]),
      pairing: (await import('../../src/main/host/pairing')).createPairingService(fx.db as unknown as import('better-sqlite3').Database),
      hostAuth: fx.hostAuth,
      gateway: createGateway({ getDb: () => fx.db as unknown as DB, handlers: new Map([['product:query', { channel: 'product:query', handler: (_e, p) => ({ got: p }) }]]) }),
      canFor: () => true,
      getDeviceSecret: (id) => (id === 'dev-1' ? SECRET_HEX : null),
      log: () => {},
      tls: { keyPem: cert.keyPem, certPem: cert.certPem },
      port: 0
    })
    const port = await app.listen()
    const requestOnce = (body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const r = https.request({
          host: '127.0.0.1', port, method: 'POST', path: '/rpc/product:query',
          rejectUnauthorized: false, headers: { 'content-type': 'application/json', ...headers }
        }, (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
        })
        r.on('error', reject)
        r.end(body)
      })

    // 无会话头 → 401 E_AUTH_FAILED，但证明 h1 客户端可连通 h1 server
    const body401 = JSON.stringify({ requestId: 'h1-1', channel: 'product:query', payload: null })
    const r1 = await requestOnce(body401, {})
    expect(r1.status).toBe(401)
    expect(JSON.parse(r1.body).code).toBe('E_AUTH_FAILED')

    // 带完整签名头的 h1 请求 → 200 ok
    const bodyOk = JSON.stringify({ requestId: 'h1-2', channel: 'product:query', payload: { q: 'h1' } })
    const res2 = await requestOnce(bodyOk, rpcHeaders(fx, bodyOk))
    expect(res2.status).toBe(200)
    const j = JSON.parse(res2.body)
    expect(j.ok).toBe(true)
    expect(j.data).toEqual({ got: { q: 'h1' } })
    await app.close()
  })
})

describe('host server /pair/result (T8 双审 A2)', () => {
  it('unknown code → expired; invalid code → 400', async () => {
    const r1 = await fx.app.inject({ method: 'GET', url: '/pair/result?code=123456' })
    expect(r1.statusCode).toBe(200)
    expect(r1.json().data.status).toBe('expired')
    const r2 = await fx.app.inject({ method: 'GET', url: '/pair/result?code=abc' })
    expect(r2.statusCode).toBe(400)
  })

  it('pending after /pair/start, granted once with secret then secret revoked, denied after deny', async () => {
    const start = await fx.app.inject({
      method: 'POST', url: '/pair/start', payload: { deviceName: 'poll-d1' }
    })
    expect(start.statusCode).toBe(200)
    const { pairingCode } = start.json().data as { pairingCode: string }
    const poll1 = await fx.app.inject({ method: 'GET', url: `/pair/result?code=${pairingCode}` })
    expect(poll1.json().data).toMatchObject({ status: 'pending', deviceName: 'poll-d1' })

    // 店长允许（index.ts pairGrant 接线等价：setPairResult granted + secret）
    fx.app.setPairResult(pairingCode, { status: 'granted', deviceId: 'dev-new', secretHex: 'ff'.repeat(32) })
    const poll2 = await fx.app.inject({ method: 'GET', url: `/pair/result?code=${pairingCode}` })
    const d2 = poll2.json().data as Record<string, unknown>
    expect(d2.status).toBe('granted')
    expect(d2.deviceId).toBe('dev-new')
    expect(d2.secret).toBe('ff'.repeat(32))
    // secret 一次性：再次轮询拿不到 secret
    const poll3 = await fx.app.inject({ method: 'GET', url: `/pair/result?code=${pairingCode}` })
    expect(poll3.json().data.secret).toBeUndefined()

    // 店长拒绝（pairDeny 接线等价）
    const started2 = await fx.app.inject({ method: 'POST', url: '/pair/start', payload: { deviceName: 'poll-d2' } })
    const code2 = (started2.json().data as { pairingCode: string }).pairingCode
    fx.app.setPairResult(code2, { status: 'denied' })
    const poll4 = await fx.app.inject({ method: 'GET', url: `/pair/result?code=${code2}` })
    expect(poll4.json().data.status).toBe('denied')
  })

  it('disconnectDevice returns 0 without hub kick installed', () => {
    expect(fx.app.disconnectDevice('dev-1')).toBe(0)
    fx.app.installKick((id) => (id === 'dev-1' ? 2 : 0))
    expect(fx.app.disconnectDevice('dev-1')).toBe(2)
  })
})
