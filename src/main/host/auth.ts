import type { Database } from 'better-sqlite3'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ok, fail, type Result } from '../../shared/result'

const SKEW_MS = 120_000
const SESSION_TTL_MS = 8 * 3600_000

export interface SessionInfo {
  userId: number
  deviceId: string
}

export interface HostAuthService {
  signPayload(secretHex: string, deviceId: string, ts: number, nonce: string, bodySha256hex: string): string
  verifyRequest(secretHex: string, deviceId: string, ts: number, nonce: string, bodySha256: string, sig: string): Result
  createSession(deviceId: string, userId: number): { token: string }
  validateSession(token: string): SessionInfo | null
  revokeSession(token: string): Result
  revokeDevice(deviceId: string): Result
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function createHostAuthService(db: Database, opts?: { clock?: () => number }): HostAuthService {
  const clock = opts?.clock ?? Date.now
  // nonce 防重放：nonce → 绝对过期时刻（ts±120s 窗口取更晚者）；过期惰性淘汰
  const nonces = new Map<string, number>()

  function pruneNonces(nowMs: number): void {
    for (const [n, exp] of nonces) {
      if (nowMs >= exp) nonces.delete(n)
    }
  }

  function revokeSessionsOfDevice(deviceId: string, now: number): void {
    db.prepare('UPDATE host_sessions SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL').run(
      new Date(now).toISOString(),
      deviceId
    )
  }

  return {
    signPayload(secretHex: string, deviceId: string, ts: number, nonce: string, bodySha256hex: string): string {
      const payload = `session${deviceId}${ts}${nonce}${bodySha256hex}`
      return createHmac('sha256', Buffer.from(secretHex, 'hex')).update(payload).digest('hex')
    },

    verifyRequest(secretHex: string, deviceId: string, ts: number, nonce: string, bodySha256: string, sig: string): Result {
      const nowMs = clock()
      const nowSec = Math.floor(nowMs / 1000)
      pruneNonces(nowMs)
      if (Math.abs(nowSec - ts) * 1000 > SKEW_MS) {
        return fail('E_CLOCK_SKEW', '请求时钟偏差超过 ±120 秒，请校准系统时间')
      }
      const expected = this.signPayload(secretHex, deviceId, ts, nonce, bodySha256)
      if (!safeEqualHex(sig, expected)) {
        return fail('E_AUTH_FAILED', '请求签名校验失败')
      }
      if (nonces.has(nonce)) {
        return fail('E_REPLAY', '检测到重放请求')
      }
      // 登记到窗口上界（ts 可能在过去/未来 ±120s）
      nonces.set(nonce, nowMs + SKEW_MS)
      return ok({ deviceId })
    },

    createSession(deviceId: string, userId: number): { token: string } {
      const now = clock()
      const device = db.prepare('SELECT revoked_at FROM host_devices WHERE device_id=?').get(deviceId) as
        | { revoked_at: string | null }
        | undefined
      if (!device) throw new Error(`device not found: ${deviceId}`)
      if (device.revoked_at) throw new Error(`device revoked: ${deviceId}`)
      const token = randomBytes(48).toString('hex')
      const iso = new Date(now).toISOString()
      db.prepare(
        `INSERT INTO host_sessions (token_hash, device_id, user_id, created_at, last_seen_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      ).run(sha256hex(token), deviceId, userId, iso, iso, new Date(now + SESSION_TTL_MS).toISOString())
      return { token }
    },

    validateSession(token: string): SessionInfo | null {
      const now = clock()
      const row = db.prepare('SELECT * FROM host_sessions WHERE token_hash=?').get(sha256hex(token)) as
        | { token_hash: string; device_id: string; user_id: number; expires_at: string; revoked_at: string | null }
        | undefined
      if (!row || row.revoked_at) return null
      if (now >= new Date(row.expires_at).getTime()) return null
      // 滑动续期
      db.prepare('UPDATE host_sessions SET expires_at=?, last_seen_at=? WHERE token_hash=?').run(
        new Date(now + SESSION_TTL_MS).toISOString(),
        new Date(now).toISOString(),
        row.token_hash
      )
      return { userId: row.user_id, deviceId: row.device_id }
    },

    revokeSession(token: string): Result {
      const info = db
        .prepare('UPDATE host_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
        .run(new Date(clock()).toISOString(), sha256hex(token))
      if (info.changes === 0) return fail('E_SESSION_NOT_FOUND', '会话不存在或已吊销')
      return ok(null)
    },

    revokeDevice(deviceId: string): Result {
      const device = db.prepare('SELECT revoked_at FROM host_devices WHERE device_id=?').get(deviceId) as
        | { revoked_at: string | null }
        | undefined
      if (!device) return fail('E_DEVICE_NOT_FOUND', `设备不存在：${deviceId}`)
      if (!device.revoked_at) {
        db.prepare('UPDATE host_devices SET revoked_at=? WHERE device_id=?').run(
          new Date(clock()).toISOString(),
          deviceId
        )
      }
      revokeSessionsOfDevice(deviceId, clock())
      return ok({ deviceId })
    }
  }
}
