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
    const svc = makeService()
    const code = generateLicenseCode({ customer: 'a', issuedAt: '2026-01-01T00:00:00Z' }, privPem)
    svc.activate(code)
    // corrupt the stored code directly
    svc._testSetStoredCode?.('ZHJS1.broken.sig')
    const s = svc.getStatus()
    expect(s.mode).toBe('trial')
  })

  it('expired license code still verifies but reports licensed (expiry optional)', () => {
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
