import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { generateLicenseCode, LICENSE_CODE_PREFIX, TRIAL_DAYS } from '../../src/shared/license'
import { createLicenseService } from '../../src/main/services/license/license.service'
import { openMemDb } from '../helpers/mem-db'

function makePair() {
  return generateKeyPairSync('ed25519')
}

let pubPem = ''
let privPem = ''
beforeEach(() => {
  const { publicKey, privateKey } = makePair()
  pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
})

function makeService() {
  return createLicenseService(openMemDb(), pubPem)
}

describe('license.service', () => {
  it('verifies a well-formed code round-trip', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: '测试客户', issuedAt: '2026-01-01T00:00:00Z', expiresAt: null },
      privPem
    )
    const payload = svc.verifyFormat(code)
    expect(payload).not.toBeNull()
    expect(payload?.customer).toBe('测试客户')
  })

  it('rejects tampered payload', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: 'a', issuedAt: '2026-01-01T00:00:00Z' },
      privPem
    )
    // tamper: swap customer letter inside base64 payload
    const parts = code.split('.')
    const body = parts[1]
    const sig = parts[2]
    if (!body || !sig) throw new Error('bad code shape')
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    json.customer = 'b'
    const tampered = `${LICENSE_CODE_PREFIX}${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}`
    expect(svc.verifyFormat(tampered)).toBeNull()
  })

  it('rejects garbage / wrong prefix / bad signature', () => {
    const svc = makeService()
    expect(svc.verifyFormat('not-a-code')).toBeNull()
    expect(svc.verifyFormat('XXX1.abc.def')).toBeNull()
    const other = makePair()
    const badCode = generateLicenseCode(
      { customer: 'a', issuedAt: '2026-01-01T00:00:00Z' },
      other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    )
    expect(svc.verifyFormat(badCode)).toBeNull()
  })

  it('first getStatus is trial with daysLeft = TRIAL_DAYS', () => {
    const svc = makeService()
    const s = svc.getStatus()
    expect(s.mode).toBe('trial')
    expect(s.daysLeft).toBe(TRIAL_DAYS)
  })

  it('activate stores code; getStatus becomes licensed', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: '客户甲', issuedAt: '2026-01-01T00:00:00Z' },
      privPem
    )
    const p = svc.activate(code)
    expect(p.customer).toBe('客户甲')
    const s = svc.getStatus()
    expect(s.mode).toBe('licensed')
    expect(s.customer).toBe('客户甲')
    expect(s.activatedAt).toBeTruthy()
  })

  it('activate with invalid code throws BizError LICENSE_INVALID', () => {
    const svc = makeService()
    expect(() => svc.activate('garbage')).toThrow(/激活码无效/)
    try {
      svc.activate('garbage')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('LICENSE_INVALID')
    }
  })

  it('stored code tampered in db → falls back to trial', () => {
    const db = openMemDb()
    const svc = createLicenseService(db, pubPem)
    const code = generateLicenseCode({ customer: 'a', issuedAt: '2026-01-01T00:00:00Z' }, privPem)
    svc.activate(code)
    // corrupt the stored code directly
    db.prepare("UPDATE app_setting SET value = 'ZHJS1.broken.sig' WHERE key = 'license.code'").run()
    const s = svc.getStatus()
    expect(s.mode).toBe('trial')
  })

  it('accepts a license with a future expiry', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: 'a', issuedAt: '2020-01-01T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' },
      privPem
    )
    svc.activate(code)
    const s = svc.getStatus()
    expect(s.mode).toBe('licensed')
    expect(s.customer).toBe('a')
  })
})

describe('license enforcement', () => {
  it('rejects an expired license', () => {
    const svc = makeService()
    const code = generateLicenseCode({
      customer: 'a', issuedAt: '2020-01-01T00:00:00Z', expiresAt: '2021-01-01T00:00:00Z'
    }, privPem)
    expect(() => svc.activate(code)).toThrow(/过期/)
  })

  it('rejects a license bound to a different machine', () => {
    const svc = createLicenseService(openMemDb(), pubPem, { machine: () => 'my-device' })
    const code = generateLicenseCode({ customer: 'a', issuedAt: '2020-01-01T00:00:00Z', machine: 'other-device' }, privPem)
    expect(() => svc.activate(code)).toThrow(/设备/)
  })

  it('uses up the grace allowance on separate rollback events', () => {
    const db = openMemDb()
    let now = Date.parse('2026-11-07T00:00:00Z')
    const svc = createLicenseService(db, pubPem, { now: () => now })
    expect(svc.getStatus().daysLeft).toBe(TRIAL_DAYS)
    for (let i = 0; i < 3; i++) {
      now -= 60 * 60 * 1000
      const days = svc.getStatus().daysLeft
      expect(svc.getStatus().daysLeft).toBe(days)
      expect(days).toBe(i < 2 ? TRIAL_DAYS : 0)
      now += 60 * 60 * 1000
      svc.getStatus()
    }
    expect(db.prepare("SELECT value FROM app_setting WHERE key = 'license.install_id'").pluck().get()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('requires online activation to return a token bound to this machine', async () => {
    const code = generateLicenseCode({ customer: 'a', issuedAt: '2020-01-01T00:00:00Z' }, privPem)
    const svc = createLicenseService(openMemDb(), pubPem, {
      machine: () => 'my-device', activationUrl: 'https://activation.example/api/activate',
      fetchImpl: async () => new Response(JSON.stringify({ code }), { status: 200 })
    })
    await expect(svc.activateOnline('redeem')).rejects.toThrow(/设备/)
    expect(svc.getStatus().mode).toBe('trial')
  })
})

it('counts each app launch with a rolled-back clock once', () => {
  const db = openMemDb()
  let time = Date.parse('2026-11-07T00:00:00Z')
  const now = () => time
  createLicenseService(db, pubPem, { now }).getStatus()
  time -= 60 * 60 * 1000
  for (let launch = 1; launch <= 3; launch++) {
    const svc = createLicenseService(db, pubPem, { now })
    expect(svc.getStatus().daysLeft).toBe(launch < 3 ? TRIAL_DAYS : 0)
    expect(svc.getStatus().daysLeft).toBe(launch < 3 ? TRIAL_DAYS : 0)
  }
})

describe('license.service v1.3 edition/features preservation', () => {
  it('verifyFormat keeps edition/features/maxDevices on pro code', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: 'Pro客户', issuedAt: '2026-01-01T00:00:00Z', edition: 'professional', features: ['lan_collaboration', 'rbac'], maxDevices: 3 },
      privPem
    )
    const payload = svc.verifyFormat(code)
    expect(payload).not.toBeNull()
    expect(payload?.edition).toBe('professional')
    expect(payload?.features).toEqual(['lan_collaboration', 'rbac'])
    expect(payload?.maxDevices).toBe(3)
  })

  it('activate returns payload with edition/features intact', () => {
    const svc = makeService()
    const code = generateLicenseCode(
      { customer: 'Pro客户', issuedAt: '2026-01-01T00:00:00Z', edition: 'professional', features: ['lan_collaboration'], maxDevices: 2 },
      privPem
    )
    const activated = svc.activate(code)
    expect(activated.edition).toBe('professional')
    expect(activated.features).toContain('lan_collaboration')
    expect(activated.maxDevices).toBe(2)
    // 激活后 verifyFormat(存储码) 也保留
    const reread = svc.verifyFormat(code)
    expect(reread?.edition).toBe('professional')
  })
})
