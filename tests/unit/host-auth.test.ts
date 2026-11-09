import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { openMemDb } from '../helpers/mem-db'
import { createHostAuthService } from '../../src/main/host/auth'

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function setup() {
  const db = openMemDb()
  let now = 1_800_000_000_000
  const svc = createHostAuthService(db, { clock: () => now })
  // 造一台已配对设备
  db.prepare(
    'INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)'
  ).run('dev-1', 'd', sha256hex('aa'.repeat(32)), new Date(now).toISOString())
  db.prepare(
    'INSERT INTO "user" (username, password_hash, role) VALUES (?,?,?)'
  ).run('admin', 'x:'.padEnd(10, 'y'), 'admin')
  const user = db.prepare('SELECT id FROM "user" WHERE username=?').get('admin') as { id: number }
  return { db, svc, now: () => now, setNow: (n: number) => { now = n }, userId: user.id }
}

function sign(svc: ReturnType<typeof createHostAuthService>, bodySha: string) {
  const ts = Math.floor(1_800_000_000_000 / 1000)
  const nonce = randomBytes(16).toString('hex')
  const sig = svc.signPayload('aa'.repeat(32), 'dev-1', ts, nonce, bodySha)
  return { ts, nonce, sig, bodySha }
}

describe('host auth service', () => {
  it('sign→verify passes', () => {
    const { svc } = setup()
    const bodySha = sha256hex('{"a":1}')
    const { ts, nonce, sig } = sign(svc, bodySha)
    const res = svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, bodySha, sig)
    expect(res.ok).toBe(true)
  })

  it('tampered bodySha or sig → E_AUTH_FAILED', () => {
    const { svc } = setup()
    const bodySha = sha256hex('{"a":1}')
    const { ts, nonce, sig } = sign(svc, bodySha)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, sha256hex('evil'), sig).code).toBe('E_AUTH_FAILED')
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, bodySha, '0'.repeat(64)).code).toBe('E_AUTH_FAILED')
  })

  it('skew 121s → E_CLOCK_SKEW; exactly 120s ok', () => {
    const { svc } = setup()
    const bodySha = sha256hex('x')
    const baseSec = Math.floor(1_800_000_000_000 / 1000)
    // 121s 偏差 → 拒
    const nonceSkew = randomBytes(16).toString('hex')
    const sigSkew = svc.signPayload('aa'.repeat(32), 'dev-1', baseSec - 121, nonceSkew, bodySha)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', baseSec - 121, nonceSkew, bodySha, sigSkew).code).toBe('E_CLOCK_SKEW')
    // 120s 整 → 不 skew，签名校验通过
    const nonceOk = randomBytes(16).toString('hex')
    const sigOk = svc.signPayload('aa'.repeat(32), 'dev-1', baseSec + 120, nonceOk, bodySha)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', baseSec + 120, nonceOk, bodySha, sigOk).ok).toBe(true)
  })

  it('same nonce replay → E_REPLAY; fresh nonce after window reuse ok', () => {
    const { svc, setNow } = setup()
    const bodySha = sha256hex('x')
    const ts = Math.floor(1_800_000_000_000 / 1000)
    const nonce = randomBytes(16).toString('hex')
    const sig = svc.signPayload('aa'.repeat(32), 'dev-1', ts, nonce, bodySha)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, bodySha, sig).ok).toBe(true)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, bodySha, sig).code).toBe('E_REPLAY')
    // 时间推过 nonce 窗口，nonce 应被淘汰，可再登记
    setNow(1_800_000_000_000 + 5 * 60_000)
    const bodySha2 = sha256hex('y')
    const sig2 = svc.signPayload('aa'.repeat(32), 'dev-1', ts + 300, nonce, bodySha2)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts + 300, nonce, bodySha2, sig2).ok).toBe(true)
  })

  it('nonce is scoped per device: another device may reuse the same nonce', () => {
    const db = openMemDb()
    const svc = createHostAuthService(db, { clock: () => 1_800_000_000_000 })
    const ts = Math.floor(1_800_000_000_000 / 1000)
    const bodySha = sha256hex('x')
    db.prepare(
      'INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)'
    ).run('dev-1', 'd', sha256hex('aa'.repeat(32)), new Date(1_800_000_000_000).toISOString())
    db.prepare(
      'INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at) VALUES (?,?,?,?)'
    ).run('dev-2', 'd', sha256hex('bb'.repeat(32)), new Date(1_800_000_000_000).toISOString())
    const nonce = randomBytes(16).toString('hex')
    const sig1 = svc.signPayload('aa'.repeat(32), 'dev-1', ts, nonce, bodySha)
    expect(svc.verifyRequest('aa'.repeat(32), 'dev-1', ts, nonce, bodySha, sig1).ok).toBe(true)
    // 设备 B 用同一 nonce：不构成重放，验签通过
    const sig2 = svc.signPayload('bb'.repeat(32), 'dev-2', ts, nonce, bodySha)
    expect(svc.verifyRequest('bb'.repeat(32), 'dev-2', ts, nonce, bodySha, sig2).ok).toBe(true)
  })

  it('createSession→validateSession passes and slides expiry', () => {
    const { db, svc, setNow, userId } = setup()
    const { token } = svc.createSession('dev-1', userId)
    const r1 = svc.validateSession(token)
    expect(r1).toEqual({ userId, deviceId: 'dev-1' })
    const exp1 = (db.prepare('SELECT expires_at FROM host_sessions WHERE token_hash=?').get(sha256hex(token)) as { expires_at: string }).expires_at
    setNow(1_800_000_000_000 + 60_000)
    svc.validateSession(token)
    const exp2 = (db.prepare('SELECT expires_at FROM host_sessions WHERE token_hash=?').get(sha256hex(token)) as { expires_at: string }).expires_at
    expect(new Date(exp2).getTime()).toBeGreaterThan(new Date(exp1).getTime())
    const seen = (db.prepare('SELECT last_seen_at FROM host_sessions WHERE token_hash=?').get(sha256hex(token)) as { last_seen_at: string }).last_seen_at
    expect(new Date(seen).getTime()).toBe(1_800_000_000_000 + 60_000)
  })

  it('session expires after 8h+1s → null', () => {
    const { svc, setNow, userId } = setup()
    const { token } = svc.createSession('dev-1', userId)
    setNow(1_800_000_000_000 + 8 * 3600_000 + 1000)
    expect(svc.validateSession(token)).toBeNull()
  })

  it('revokeSession → null', () => {
    const { svc, userId } = setup()
    const { token } = svc.createSession('dev-1', userId)
    svc.revokeSession(token)
    expect(svc.validateSession(token)).toBeNull()
  })

  it('revokeDevice kills all device sessions', () => {
    const { svc, userId } = setup()
    const { token } = svc.createSession('dev-1', userId)
    svc.revokeDevice('dev-1')
    expect(svc.validateSession(token)).toBeNull()
  })

  it('token plaintext never stored, only hash', () => {
    const { db, svc, userId } = setup()
    const { token } = svc.createSession('dev-1', userId)
    const rows = db.prepare('SELECT token_hash FROM host_sessions').all() as { token_hash: string }[]
    expect(rows.length).toBe(1)
    expect(rows[0]?.token_hash).toBe(sha256hex(token))
    expect(rows[0]?.token_hash).not.toBe(token)
  })
})
