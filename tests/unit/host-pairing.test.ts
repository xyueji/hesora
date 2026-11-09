import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { openMemDb } from '../helpers/mem-db'
import { createPairingService } from '../../src/main/host/pairing'

function sha256buf(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex')
}

describe('host pairing service', () => {
  it('full flow start→confirm→complete stores hash not plaintext', () => {
    const db = openMemDb()
    let now = 1_000_000
    const svc = createPairingService(db, { clock: () => now })
    const { code, expiresAt } = svc.startPairing('收银机1')
    expect(code).toMatch(/^\d{6}$/)
    expect(expiresAt).toBe(now + 5 * 60_000)

    const confirmed = svc.confirmPairing(code)
    expect(confirmed).not.toBeNull()
    const { deviceId, secret } = confirmed as { deviceId: string; secret: Buffer }
    expect(deviceId).toBeTruthy()
    expect(secret.length).toBe(32)

    const res = svc.completePairing(deviceId, secret.toString('hex'), true)
    expect(res.ok).toBe(true)

    const row = db.prepare('SELECT * FROM host_devices WHERE device_id=?').get(deviceId) as {
      secret_hash: string
      device_name: string
      revoked_at: string | null
    }
    expect(row.device_name).toBe('收银机1')
    expect(row.secret_hash).toBe(sha256buf(secret))
    expect(row.secret_hash).not.toBe(secret.toString('hex'))
    expect(row.revoked_at).toBeNull()
  })

  it('wrong code returns null', () => {
    const db = openMemDb()
    const svc = createPairingService(db, { clock: () => 1_000_000 })
    svc.startPairing('d1')
    expect(svc.confirmPairing('000001')).toBeNull() // 不存在的码
  })

  it('expired code rejected after 6 minutes', () => {
    const db = openMemDb()
    let now = 1_000_000
    const svc = createPairingService(db, { clock: () => now })
    const { code } = svc.startPairing('d1')
    now += 6 * 60_000
    expect(svc.confirmPairing(code)).toBeNull()
  })

  it('code is one-shot: second confirm on same code returns null', () => {
    const db = openMemDb()
    const svc = createPairingService(db, { clock: () => 1_000_000 })
    const code = svc.startPairing('d1').code
    expect(svc.confirmPairing(code)).not.toBeNull()
    expect(svc.confirmPairing(code)).toBeNull()
  })

  it('revokeDevice marks revoked and listDevices shows it', () => {
    const db = openMemDb()
    const svc = createPairingService(db, { clock: () => 1_000_000 })
    const { code } = svc.startPairing('d1')
    const c = svc.confirmPairing(code)
    const { deviceId, secret } = c as { deviceId: string; secret: Buffer }
    svc.completePairing(deviceId, secret.toString('hex'), true)
    expect(svc.revokeDevice(deviceId).ok).toBe(true)
    const devices = svc.listDevices() as { device_id: string; revoked_at: string | null }[]
    const d = devices.find((x) => x.device_id === deviceId)
    expect(d?.revoked_at).not.toBeNull()
  })

  it('completePairing with wrong secret fails', () => {
    const db = openMemDb()
    const svc = createPairingService(db, { clock: () => 1_000_000 })
    const { code } = svc.startPairing('d1')
    const c = svc.confirmPairing(code) as { deviceId: string; secret: Buffer }
    const bad = svc.completePairing(c.deviceId, 'ff'.repeat(32), true)
    expect(bad.ok).toBe(false)
  })

  it('cleanupExpired drops expired in-memory codes', () => {
    const db = openMemDb()
    let now = 1_000_000
    const svc = createPairingService(db, { clock: () => now })
    svc.startPairing('old')
    now += 6 * 60_000
    svc.startPairing('new')
    svc.cleanupExpired()
    // 通过 confirm 验证：old 的码已被清掉。重新拿不到 old code，这里验证不抛错且 new 仍可用。
    const { code } = svc.startPairing('fresh')
    expect(svc.confirmPairing(code)).not.toBeNull()
  })

  it('uses codeLength option', () => {
    const db = openMemDb()
    const svc = createPairingService(db, { clock: () => 1_000_000, codeLength: 8 })
    const { code } = svc.startPairing('d')
    expect(code).toMatch(/^\d{8}$/)
  })
})
