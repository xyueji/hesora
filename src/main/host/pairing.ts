import type { Database } from 'better-sqlite3'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { ok, fail, type Result } from '../../shared/result'

export interface PairingCodeEntry {
  deviceName: string
  secret: Buffer
  expiresAt: number
  attempts: number
  confirmed: boolean
}

export interface PairedDeviceInfo {
  device_id: string
  device_name: string
  paired_at: string
  revoked_at: string | null
  last_seen_at: string | null
}

export interface PairingService {
  startPairing(deviceName: string): { code: string; expiresAt: number }
  confirmPairing(code: string): { deviceId: string; secret: Buffer } | null
  completePairing(deviceId: string, secretHex: string, approved: boolean): Result
  revokeDevice(deviceId: string): Result
  listDevices(): PairedDeviceInfo[]
  cleanupExpired(): void
}

function sha256hex(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex')
}

export function createPairingService(
  db: Database,
  opts?: { clock?: () => number; codeLength?: number; ttlMs?: number; maxAttempts?: number }
): PairingService {
  const clock = opts?.clock ?? Date.now
  const codeLength = opts?.codeLength ?? 6
  const ttlMs = opts?.ttlMs ?? 5 * 60_000
  const maxAttempts = opts?.maxAttempts ?? 5
  const codes = new Map<string, PairingCodeEntry>()

  function generateCode(): string {
    const max = 10 ** codeLength
    return String(randomInt(0, max)).padStart(codeLength, '0')
  }

  function insertDevice(deviceId: string, deviceName: string, secretHash: string, now: number): void {
    db.prepare(
      `INSERT INTO host_devices (device_id, device_name, secret_hash, paired_at, revoked_at, last_seen_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run(deviceId, deviceName, secretHash, new Date(now).toISOString(), new Date(now).toISOString())
  }

  return {
    startPairing(deviceName: string) {
      const now = clock()
      const code = generateCode()
      codes.set(code, {
        deviceName,
        secret: randomBytes(32),
        expiresAt: now + ttlMs,
        attempts: 0,
        confirmed: false
      })
      return { code, expiresAt: now + ttlMs }
    },

    confirmPairing(code: string) {
      const now = clock()
      const entry = codes.get(code)
      if (!entry) return null
      if (entry.confirmed) return null
      if (now >= entry.expiresAt) {
        codes.delete(code)
        return null
      }
      if (entry.attempts >= maxAttempts) {
        codes.delete(code)
        return null
      }
      entry.confirmed = true
      const deviceId = randomUUID()
      insertDevice(deviceId, entry.deviceName, sha256hex(entry.secret), now)
      return { deviceId, secret: entry.secret }
    },

    completePairing(deviceId: string, secretHex: string, approved: boolean): Result {
      const row = db.prepare('SELECT secret_hash, revoked_at FROM host_devices WHERE device_id=?').get(deviceId) as
        | { secret_hash: string; revoked_at: string | null }
        | undefined
      if (!row) return fail('E_DEVICE_NOT_FOUND', `设备不存在：${deviceId}`)
      if (row.revoked_at) return fail('E_DEVICE_REVOKED', '设备已吊销')
      const given = Buffer.from(secretHex, 'hex')
      const givenHash = Buffer.from(sha256hex(given), 'hex')
      const expected = Buffer.from(row.secret_hash, 'hex')
      if (given.length !== 32 || givenHash.length !== expected.length || !timingSafeEqual(givenHash, expected)) {
        return fail('E_SECRET_MISMATCH', '设备密钥校验失败')
      }
      if (!approved) return fail('E_PAIRING_REJECTED', '配对被拒绝')
      return ok({ deviceId })
    },

    revokeDevice(deviceId: string): Result {
      const row = db.prepare('SELECT revoked_at FROM host_devices WHERE device_id=?').get(deviceId) as
        | { revoked_at: string | null }
        | undefined
      if (!row) return fail('E_DEVICE_NOT_FOUND', `设备不存在：${deviceId}`)
      if (row.revoked_at) return fail('E_DEVICE_REVOKED', '设备已吊销')
      db.prepare('UPDATE host_devices SET revoked_at=? WHERE device_id=?').run(
        new Date(clock()).toISOString(),
        deviceId
      )
      return ok({ deviceId })
    },

    listDevices(): PairedDeviceInfo[] {
      return db
        .prepare(
          'SELECT device_id, device_name, paired_at, revoked_at, last_seen_at FROM host_devices ORDER BY paired_at'
        )
        .all() as PairedDeviceInfo[]
    },

    cleanupExpired(): void {
      const now = clock()
      for (const [code, entry] of codes) {
        if (now >= entry.expiresAt || entry.attempts >= maxAttempts) codes.delete(code)
      }
    }
  }
}
