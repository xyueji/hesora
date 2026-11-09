// v1.3 Task 8: WS hub 接线集成测试。
// 真实起 server（TLS, port:0）+ attachWsHub（模拟 index.ts 装配逻辑），
// 用 ws 客户端连 /events?token=... → subscribe → 收 subscribed；无效 token → close 4001；
// 非 /events 路径 upgrade → 直接 close；无 ping 防双 ping 裁定（hub 25s JSON ping 唯一心跳，
// server.ts 无任何 ping——本测试 pingIntervalMs 用默认但客户端立即断开，不做长等待）。
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll, vi } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createHostServer } from '../../src/main/host/server'
import { createGateway } from '../../src/main/host/gateway'
import { createHostAuthService } from '../../src/main/host/auth'
import { createPairingService } from '../../src/main/host/pairing'
import { createEventHub, type WsLike } from '../../src/main/host/events'
import { setHostEventSink, emitHostEvent } from '../../src/main/host/event-bus'
import type { DB } from '../../src/main/db'
import type { IncomingMessage } from 'node:http'
import type { WebSocket as WsClient } from 'ws'

const SECRET_HEX = 'aa'.repeat(32)
const cleanups: string[] = []
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true })
  setHostEventSink(null)
})

interface Ctx {
  url: (path: string, token?: string) => string
  token: string
}

async function startWired(): Promise<Ctx> {
  const db = openMemDb()
  const hostAuth = createHostAuthService(db as unknown as import('better-sqlite3').Database)
  const pairing = createPairingService(db as unknown as import('better-sqlite3').Database)
  const gw = createGateway({ getDb: () => db as unknown as DB, handlers: new Map() })
  db.prepare('INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)').run(
    'dev-1', 'd1', SECRET_HEX, new Date().toISOString()
  )
  db.prepare('INSERT INTO "user" (username, password_hash, role) VALUES (?,?,?)').run('admin', 'x'.repeat(20), 'admin')
  const { token } = hostAuth.createSession('dev-1', 1)
  const { ensureHostCertificate } = await import('../../src/main/host/cert')
  const certDir = mkdtempSync(join(tmpdir(), 'ws-wire-test-'))
  cleanups.push(certDir)
  const cert = await ensureHostCertificate(certDir)
  const app = await createHostServer({
    getDb: () => db as unknown as DB,
    handlers: new Map(),
    pairing,
    hostAuth,
    gateway: gw,
    canFor: () => true,
    getDeviceSecret: (id) => (id === 'dev-1' ? SECRET_HEX : null),
    log: () => {},
    tls: { keyPem: cert.keyPem, certPem: cert.certPem },
    port: 0
  })
  const port = await app.listen()

  // —— 与 index.ts T8 装配区相同的接线逻辑（集成镜像）——
  const hub = createEventHub({ log: () => {} })
  setHostEventSink((event) => hub.broadcast(event))
  app.onConnection((ws: unknown, req: IncomingMessage) => {
    const u = req.url ?? ''
    if (!(u === '/events' || u.startsWith('/events?') || u.startsWith('/events/'))) {
      ;(ws as { close: () => void }).close()
      return
    }
    const tokenQ = new URL(u, 'https://local').searchParams.get('token')
    const session = tokenQ ? hostAuth.validateSession(tokenQ) : null
    if (!session) {
      ;(ws as { close: (code?: number) => void }).close(4001)
      return
    }
    hub.registerConnection(ws as WsLike, { deviceId: session.deviceId, userId: session.userId }, () => true)
  })
  return { url: (path, tok) => `wss://127.0.0.1:${port}${path}${tok !== undefined ? `?token=${tok}` : ''}`, token }
}

function wsOpen(url: string): Promise<WsClient> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebSocket } = require('ws') as typeof import('ws')
  const ws = new WebSocket(url, { rejectUnauthorized: false })
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function wsNext(ws: WsClient, timeoutMs = 3000): Promise<{ type: string; [k: string]: unknown }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws message timeout')), timeoutMs)
    ws.once('message', (raw: Buffer) => {
      clearTimeout(t)
      resolve(JSON.parse(raw.toString()) as { type: string })
    })
  })
}

function wsCloseInfo(ws: WsClient): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.once('close', (code: number) => resolve({ code }))
  })
}

describe('Task 8: WS hub wiring (integration)', () => {
  // T8 双审勘误：真实 TLS server + ws 握手偶发慢，整组放宽到 15s 防 flaky。
  vi.setConfig({ testTimeout: 15_000 })
  it('valid token on /events → subscribe → subscribed', async () => {
    const ctx = await startWired()
    const ws = await wsOpen(ctx.url('/events', ctx.token))
    ws.send(JSON.stringify({ type: 'subscribe', events: ['doc.changed', 'inventory.changed'] }))
    const msg = await wsNext(ws)
    expect(msg.type).toBe('subscribed')
    expect(msg.events).toEqual(['doc.changed', 'inventory.changed'])
    // 业务事件发射 → 已订阅客户端收到红线剥离后的 {type:'event',event,at,summary}
    emitHostEvent({ event: 'doc.changed', at: new Date().toISOString(), summary: { no: 'X1' } })
    const ev = await wsNext(ws)
    expect(ev.type).toBe('event')
    expect(ev.event).toBe('doc.changed')
    expect(ev.summary).toEqual({ no: 'X1' })
    ws.close()
  })

  it('invalid token → close 4001', async () => {
    const ctx = await startWired()
    const ws = await wsOpen(ctx.url('/events', 'bad-token'))
    const { code } = await wsCloseInfo(ws)
    expect(code).toBe(4001)
  })

  it('no token → close 4001', async () => {
    const ctx = await startWired()
    const ws = await wsOpen(ctx.url('/events'))
    const { code } = await wsCloseInfo(ws)
    expect(code).toBe(4001)
  })

  it('upgrade to non-/events path → closed', async () => {
    const ctx = await startWired()
    const ws = await wsOpen(ctx.url('/other-path', ctx.token))
    await wsCloseInfo(ws)
    expect(true).toBe(true) // 到这里即说明连接被服务端关闭（open 后立即 close）
  })
})
