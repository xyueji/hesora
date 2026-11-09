import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import {
  generateLicenseCode,
  resolveLicenseFeatures,
  hasFeature,
  LICENSE_CODE_PREFIX,
  type LicensePayload
} from '../../src/shared/license'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** 用 Node 内置 verify 解码并验签，返回 payload 对象（模拟主进程激活流程） */
function decode(code: string): LicensePayload {
  expect(code.startsWith(LICENSE_CODE_PREFIX)).toBe(true)
  const [bodyRaw, sigRaw] = code.slice(LICENSE_CODE_PREFIX.length).split('.')
  if (!bodyRaw || !sigRaw) throw new Error('malformed license code')
  const canonical = Buffer.from(bodyRaw, 'base64url').toString('utf8')
  expect(verify(null, Buffer.from(canonical, 'utf8'), pubPem, Buffer.from(sigRaw, 'base64url'))).toBe(true)
  return JSON.parse(canonical) as LicensePayload
}

describe('resolveLicenseFeatures', () => {
  it('undefined/null → standard / [] / 1', () => {
    for (const p of [undefined, null]) {
      expect(resolveLicenseFeatures(p)).toEqual({ edition: 'standard', features: [], maxDevices: 1 })
      expect(hasFeature(p, 'lan_collaboration')).toBe(false)
    }
  })
  it('legacy payload (no edition) → standard defaults', () => {
    const legacy: LicensePayload = { customer: '老客户', issuedAt: '2026-01-01' }
    expect(resolveLicenseFeatures(legacy)).toEqual({ edition: 'standard', features: [], maxDevices: 1 })
  })
  it('professional + features parsed; unknown feature filtered', () => {
    const p: LicensePayload = {
      customer: 'c', issuedAt: '2026-01-01', edition: 'professional',
      features: ['lan_collaboration', 'cloud_backup', 'bogus' as never], maxDevices: 8
    }
    expect(resolveLicenseFeatures(p)).toEqual({ edition: 'professional', features: ['lan_collaboration', 'cloud_backup'], maxDevices: 8 })
    expect(hasFeature(p, 'lan_collaboration')).toBe(true)
    expect(hasFeature(p, 'rbac')).toBe(false)
  })
  it('invalid edition → standard', () => {
    const p = { customer: 'c', issuedAt: 'x', edition: 'ultimate', features: ['rbac'], maxDevices: 5 } as unknown as LicensePayload
    expect(resolveLicenseFeatures(p)).toEqual({ edition: 'standard', features: [], maxDevices: 1 })
  })
  it('maxDevices 0 / -5 / NaN / 2.5 → 1; valid kept', () => {
    const base = { customer: 'c', issuedAt: 'x', edition: 'professional' } as const
    expect(resolveLicenseFeatures({ ...base, maxDevices: 0 }).maxDevices).toBe(1)
    expect(resolveLicenseFeatures({ ...base, maxDevices: -5 }).maxDevices).toBe(1)
    expect(resolveLicenseFeatures({ ...base, maxDevices: Number.NaN }).maxDevices).toBe(1)
    expect(resolveLicenseFeatures({ ...base, maxDevices: 2.5 }).maxDevices).toBe(1)
    expect(resolveLicenseFeatures({ ...base, maxDevices: 3 }).maxDevices).toBe(3)
  })
  it('generateLicenseCode roundtrip preserves edition/features/maxDevices', () => {
    const payload: LicensePayload = {
      customer: '禾序科技', issuedAt: '2026-11-09T00:00:00Z', expiresAt: '2027-11-09T00:00:00Z',
      machine: 'M-ABC', edition: 'professional',
      features: ['lan_collaboration', 'device_handoff'], maxDevices: 12
    }
    const code = generateLicenseCode(payload, privPem)
    const decoded = decode(code)
    expect(decoded.edition).toBe('professional')
    expect(decoded.features).toEqual(['lan_collaboration', 'device_handoff'])
    expect(decoded.maxDevices).toBe(12)
    expect(resolveLicenseFeatures(decoded)).toEqual({
      edition: 'professional', features: ['lan_collaboration', 'device_handoff'], maxDevices: 12
    })
  })
})
