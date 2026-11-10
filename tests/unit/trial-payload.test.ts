import { describe, it, expect } from 'vitest'
import { effectiveLicensePayload, TRIAL_FULL_PAYLOAD } from '../../src/main/services/license/trial-payload'
import { resolveLicenseFeatures, hasFeature, type LicenseFeature, type LicensePayload } from '../../src/shared/license'

const ALL_FEATURES: LicenseFeature[] = [
  'lan_collaboration', 'cloud_backup', 'multi_warehouse', 'rbac', 'device_handoff', 'serial_batch'
]

const REAL: LicensePayload = {
  customer: '正式客户',
  issuedAt: '2026-01-01T00:00:00Z',
  edition: 'standard',
  features: ['lan_collaboration'],
  maxDevices: 2
}

describe('trial-payload effectiveLicensePayload', () => {
  it('TRIAL_FULL_PAYLOAD 是 professional 且含全部 6 个特征位', () => {
    expect(TRIAL_FULL_PAYLOAD.customer).toBe('试用用户')
    expect(TRIAL_FULL_PAYLOAD.issuedAt).toBe('')
    expect(resolveLicenseFeatures(TRIAL_FULL_PAYLOAD).edition).toBe('professional')
    for (const f of ALL_FEATURES) {
      expect(hasFeature(TRIAL_FULL_PAYLOAD, f)).toBe(true)
    }
    expect(resolveLicenseFeatures(TRIAL_FULL_PAYLOAD).maxDevices).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('effectiveLicensePayload(null, true) 返回试用全功能载荷', () => {
    const p = effectiveLicensePayload(null, true)
    expect(p).toBe(TRIAL_FULL_PAYLOAD)
    expect(resolveLicenseFeatures(p).edition).toBe('professional')
    for (const f of ALL_FEATURES) {
      expect(hasFeature(p, f)).toBe(true)
    }
  })

  it('effectiveLicensePayload(REAL, true) 返回 real 本身（已激活按真实授权判定）', () => {
    const p = effectiveLicensePayload(REAL, true)
    expect(p).toBe(REAL)
    expect(resolveLicenseFeatures(p).edition).toBe('standard')
    expect(resolveLicenseFeatures(p).maxDevices).toBe(2)
  })

  it('effectiveLicensePayload(null, false) 过期只读不授予全功能（无专业版特征）', () => {
    const p = effectiveLicensePayload(null, false)
    expect(p).toBeNull()
    expect(resolveLicenseFeatures(p).edition).toBe('standard')
    for (const f of ALL_FEATURES) {
      expect(hasFeature(p, f)).toBe(false)
    }
  })

  it('effectiveLicensePayload(REAL, false) 过期只读同样不授予全功能（授权漏洞防护）', () => {
    const p = effectiveLicensePayload(REAL, false)
    expect(p).toBeNull()
    expect(hasFeature(p, 'lan_collaboration')).toBe(false)
  })
})
