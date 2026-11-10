// v1.4 T9：客户端连接集成测试——真实 createHostServer + createClientConnection 全流程。
// 覆盖：/pair/start → 主机 setPairResult(granted) → 客户端轮询拿到 secret+指纹
// → /auth/session → invoke('product:query') → 主机吊销（DB revoked + 移除 secret + 踢连接）
// → 客户端状态 revoked；断线 → pending 幂等登记 → 重连后重发仅生效一次。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createHostServer } from '../../src/main/host/server'
import { createGateway } from '../../src/main/host/gateway'
import { createHostAuthService } from '../../src/main/host/auth'
import { createPairingService } from '../../src/main/host/pairing'
import { ensureHostCertificate } from '../../src/main/host/cert'
import { createClientConnection } from '../../src/main/host/client-connection'
import type { ClientConnectionState } from '../../src/main/host/client-connection'
import { createUserService } from '../../src/main/services/user/user.service'
import type { IpcHandler } from '../../src/shared/result'
import type { DB } from '../../src/main/db'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

interface Rig {
  server: Awaited<ReturnType<typeof createHostServer>>
  client: ReturnType<typeof createClientConnection>
  db: ReturnType<typeof openMemDb>
  url: string
  states: ClientConnectionState[]
  fingerprintHex: string
  secretRegistry: Map<string, string>
  pairing: ReturnType<typeof createPairingService>
  cert: { keyPem: string; certPem: string; fingerprintHex: string }
}

export async function setupRig(handlerOverrides: Record<string, IpcHandler> = {}): Promise<Rig> {
  const db = openMemDb()
  const hostAuth = createHostAuthService(db as unknown as import('better-sqlite3').Database)
  const pairing = createPairingService(db as unknown as import('better-sqlite3').Database)
  const handlers = new Map(
    Object.entries(handlerOverrides).map(([channel, handler]) => [channel, { channel, handler }])
  )
  const gw = createGateway({ getDb: () => db as unknown as DB, handlers })
  // 主机侧设备 secret 登记（等价 index.ts pairGrant：confirmPairing 产出后在此注册）
  const secretRegistry = new Map<string, string>()

  // 主机店长账号（真实 hashPassword 格式 scrypt salt:hash，走 /auth/session 校验）
  const userSvc = createUserService(db as never)
  userSvc.create({ username: 'boss', password: 'Rig-pass-123', role: 'admin' })

  // 真实 TLS 证书（客户端走 node:https，必须真实端口）
  const certDir = mkdtempSync(join(tmpdir(), 'hx-client-rig-'))
  dirs.push(certDir)
  const cert = await ensureHostCertificate(certDir)
  const fpHex = cert.fingerprintHex.toLowerCase()

  const server = await createHostServer({
    port: 0,
    getDb: () => db as unknown as DB,
    handlers,
    pairing,
    hostAuth,
    gateway: gw,
    canFor: () => true,
    getDeviceSecret: (id) => secretRegistry.get(id) ?? null,
    getFingerprintHex: () => fpHex,
    sessionLogin: (username, password) => {
      const user = userSvc.verify(username, password)
      if (!user) return null
      return { user: { id: user.id, username: user.username, role: user.role }, permissions: [] }
    },
    tls: { keyPem: cert.keyPem, certPem: cert.certPem },
    log: () => {}
  })

  const port = await server.listen()
  const url = `https://127.0.0.1:${port}`

  // WS hub 接线（等价 index.ts：installKick + onConnection→registerConnection）
  const { createEventHub } = await import('../../src/main/host/events')
  const hub = createEventHub({ pingIntervalMs: 0 })
  server.installKick((deviceId, closeCode) => hub.disconnectDevice(deviceId, closeCode))
  server.onConnection((ws: unknown, req: import('node:http').IncomingMessage) => {
    const u = req.url ?? ''
    if (!(u === '/events' || u.startsWith('/events?') || u.startsWith('/events/'))) {
      try { (ws as { close: () => void }).close() } catch { /* ignore */ }
      return
    }
    const token = new URL(u, 'https://local').searchParams.get('token')
    const session = token ? hostAuth.validateSession(token) : null
    if (!session) {
      try { (ws as { close: (code?: number) => void }).close(4001) } catch { /* ignore */ }
      return
    }
    hub.registerConnection(
      ws as never,
      { deviceId: session.deviceId, userId: session.userId },
      () => true
    )
  })

  // 客户端连接（真实状态机；内存 setting + 内存凭据）
  const settings = new Map<string, string>()
  const creds = new Map<string, { secretHex: string; fingerprintHex: string; token: string }>()
  const states: ClientConnectionState[] = []
  const client = createClientConnection({
    getSetting: (k) => settings.get(k) ?? null,
    setSetting: (k, v) => void settings.set(k, v),
    credentialStore: {
      available: () => true,
      save: (host, v) => { creds.set(host, v); return true },
      load: (host) => creds.get(host) ?? { secretHex: '', fingerprintHex: '', token: '' },
      remove: (host) => void creds.delete(host)
    },
    pollIntervalMs: 50,
    requestTimeoutMs: 4_000,
    onStateChanged: (s) => states.push(s),
    log: () => {}
  })
  return { server, client, db, url, states, fingerprintHex: fpHex, secretRegistry, pairing, cert }
}

async function waitFor(pred: () => boolean, timeoutMs = 10_000, stepMs = 50): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

describe('client connection integration (T9)', () => {
  it('full flow: pair → granted → session → invoke ok → host revoke → client revoked', async () => {
    let queried = 0
    const rig = await setupRig({ 'product:query': (_e, p) => { queried++; return { got: p } } })
    const { client, server, db, url } = rig

    // 1. 申请配对
    const started = await client.pairStart({ address: url, deviceName: '前台收银机', username: 'boss', password: 'Rig-pass-123' })
    expect(started.ok).toBe(true)
    const code = (started.data as { pairingCode: string }).pairingCode
    expect(code).toMatch(/^\d{6}$/)
    await waitFor(() => client.status().status === 'pairing')

    // 2. 主机店长确认（index.ts pairGrant 等价：confirmPairing 生成真实设备行+secret
    //    → setPairResult granted 一次性下发 + 证书指纹）。hostAuth.createSession 要求
    //    host_devices 有真实行，故必须走 confirmPairing 而非合成 secret。
    const confirmed = rig.pairing.confirmPairing(code)
    expect(confirmed, 'confirmPairing should succeed').not.toBeNull()
    const deviceId = confirmed!.deviceId
    const secretHex = confirmed!.secret.toString('hex')
    rig.secretRegistry.set(deviceId, secretHex)
    server.setPairResult(code, { status: 'granted', deviceId, secretHex, fingerprintHex: rig.fingerprintHex })

    // 3. 客户端轮询拿到 secret+指纹 → 自动 /auth/session → connected
    await waitFor(() => client.status().status === 'connected', 15_000)
    const st = client.status()
    expect(st.deviceId).toBe(deviceId)
    expect(st.hostName).toBe('boss')
    expect(st.hostAddress).toBe(url)
    expect(st.configured).toBe(true)
    // 配对码已消费
    expect(client.status().pairingCode).toBeNull()

    // 4. 业务 invoke 走通
    const r = await client.invoke('product:query', { q: 'cola' })
    expect(r.ok, `invoke: ${r.msg}`).toBe(true)
    expect((r.data as { got: unknown }).got).toEqual({ q: 'cola' })
    expect(queried).toBe(1)

    // 5. 主机吊销：DB revoked + 移除设备 secret（等价 index.ts host:deviceRevoke 接线）
    db.prepare('UPDATE host_devices SET revoked_at=? WHERE device_id=?').run(new Date().toISOString(), deviceId)
    server.disconnectDevice(deviceId, 4003)
    rig.secretRegistry.delete(deviceId)

    // 6. 客户端感知吊销（WS close(4003) → onRevoked → 'revoked'）
    await waitFor(() => client.status().status === 'revoked', 15_000)
    expect(client.status().lastErrorCode).toBe('E_NOT_PAIRED')
    // 请求层也已拒绝
    const r2 = await client.invoke('product:query', { q: 'x' })
    expect(r2.ok).toBe(false)
    // 清理：停掉客户端重连定时器再关服务器（wss.close 等活跃连接关闭）
    client.disconnect()
    await server.close()
  }, 30_000)

  it('disconnect → pending idempotent re-registration → reconnect resend takes effect once', async () => {
    let posted = 0
    let applied = 0
    const rig = await setupRig({
      'sale:create': () => { posted++; applied++; return { no: 'XS001' } },
      'product:query': () => ({ ok: true })
    })
    const { client, server, url } = rig

    // 配对连接
    const started = await client.pairStart({ address: url, deviceName: 'd2', username: 'boss', password: 'Rig-pass-123' })
    expect(started.ok).toBe(true)
    const code = (started.data as { pairingCode: string }).pairingCode
    const confirmed2 = rig.pairing.confirmPairing(code)
    expect(confirmed2).not.toBeNull()
    const dev2 = confirmed2!.deviceId
    const secret2 = confirmed2!.secret.toString('hex')
    rig.secretRegistry.set(dev2, secret2)
    server.setPairResult(code, { status: 'granted', deviceId: dev2, secretHex: secret2, fingerprintHex: rig.fingerprintHex })
    await waitFor(() => client.status().status === 'connected', 15_000)
    
    // 模拟主机不可达（断开真实监听）→ 幂等通道 invoke 失败但保留 pending 登记。
    // wss.close() 会等活跃连接关闭（hub 无 dispose API），故先踢设备再关。
    // 注意用 1000（正常关闭）而非 4003：4003 会被客户端判定为"设备吊销"，
    // 清 token 并停重连——这是本用例要模拟的"主机宕机"，不是吊销。
    server.disconnectDevice(dev2, 1000)
    await server.close()
    const r = await client.invoke('sale:create', { lines: [] })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_HOST_UNREACHABLE')
    expect(client.pendingSize()).toBe(1)

    // 重启主机：监听回原端口（client hostAddress 不变，重发请求可达同一地址）。
    // 关键：网关必须挂同一套业务 handler（sale:create 等），否则 /rpc 会回
    // NOT_FOUND（确定性失败 → pending 被 settle 删除，applied 永不 +1 → 之前 waitFor 超时）。
    // createHostServer 自身不消费 deps.handlers，路由全经 gateway，故两处都要传 handlers2。
    const oldPort = Number(new URL(url).port)
    const handlers2 = new Map([
      ['sale:create', { channel: 'sale:create', handler: () => { posted++; applied++; return { no: 'XS001' } } }],
      ['product:query', { channel: 'product:query', handler: () => ({ ok: true }) }],
      ['session:ping', { channel: 'session:ping', handler: () => ({ pong: true }) }]
    ])
    const server2 = await createHostServer({
      port: oldPort,
      getDb: () => rig.db as unknown as DB,
      handlers: handlers2,
      pairing: rig.pairing,
      hostAuth: createHostAuthService(rig.db as unknown as import('better-sqlite3').Database),
      tls: { keyPem: rig.cert.keyPem, certPem: rig.cert.certPem },
      gateway: createGateway({ getDb: () => rig.db as unknown as DB, handlers: handlers2 }),
      canFor: () => true,
      getDeviceSecret: (id) => rig.secretRegistry.get(id) ?? null,
      sessionLogin: (username, password) => {
        const user = createUserService(rig.db as never).verify(username, password)
        if (!user) return null
        return { user: { id: user.id, username: user.username, role: user.role }, permissions: [] }
      },
      log: () => {}
    })
    const port2 = await server2.listen()
    expect(port2).toBe(oldPort)

    // 显式按原 requestId 重发 pending（接线层 reconnect 成功路径同款调用）。
    // 注意：主机重听后客户端 lan-client 的重连探测（session:ping）与 WS /events
    // 重连会并发进行；probe 被拒（401 E_AUTH_FAILED）会把状态机切 revoked 并清
    // token，所以这里在 server2 就绪后立刻重发，赶在退避重连之前。
    // 重发（同 requestId → 主机幂等表命中缓存 → 只生效一次）。负载抖动下单次
    // resend 可能恰好撞上重连窗口，循环重发直到生效（幂等保证多次发送安全）。
    await waitFor(() => {
      void client.resendPending()
      return applied >= 1
    }, 20_000, 500)
    // 幂等：再发一次（同 requestId）主机幂等表命中 → 只生效一次
    await client.resendPending()
    expect(applied).toBe(1)
    expect(posted).toBe(1)
    // pending 已收敛（重发成功后 settle 删除）
    await waitFor(() => client.pendingSize() === 0, 20_000)
    server2.disconnectDevice(dev2, 1000)
    client.disconnect()
    await server2.close()
  }, 30_000)
})
