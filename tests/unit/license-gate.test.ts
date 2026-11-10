import { describe, it, expect } from 'vitest'
import {
  assertProEdition,
  assertFeature,
  assertMaxDevices,
  E_FEATURE_PRO,
  E_DEVICE_LIMIT
} from '../../src/main/services/license-gate'
import type { LicensePayload } from '../../src/shared/license'
import { BizError } from '../../src/shared/result'

const pro: LicensePayload = {
  customer: 'c', issuedAt: '2026-11-01', edition: 'professional',
  features: ['lan_collaboration', 'cloud_backup', 'multi_warehouse', 'rbac', 'device_handoff'],
  maxDevices: 3
}
const standard: LicensePayload = { customer: 'c', issuedAt: '2026-11-01' }

function expectBizError(fn: () => void, code: string): BizError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(BizError)
    const biz = e as BizError
    expect(biz.code).toBe(code)
    return biz
  }
  throw new Error(`expected BizError(${code}) but nothing thrown`)
}

describe('license-gate', () => {
  it('assertProEdition: standard / legacy / null 抛 E_FEATURE_PRO，professional 放行', () => {
    expectBizError(() => assertProEdition(standard), E_FEATURE_PRO)
    expectBizError(() => assertProEdition(null), E_FEATURE_PRO)
    expectBizError(() => assertProEdition(undefined), E_FEATURE_PRO)
    expect(() => assertProEdition(pro)).not.toThrow()
  })

  it('assertFeature: 未含特征位抛 E_FEATURE_PRO，含则放行', () => {
    expectBizError(() => assertFeature(standard, 'rbac'), E_FEATURE_PRO)
    expectBizError(() => assertFeature(pro, 'serial_batch'), E_FEATURE_PRO) // pro payload 不含 serial_batch 时
    expect(() => assertFeature(pro, 'multi_warehouse')).not.toThrow()
  })

  it('assertMaxDevices: currentCount >= maxDevices 抛 E_DEVICE_LIMIT；standard 上限为 1', () => {
    expectBizError(() => assertMaxDevices(standard, 1), E_DEVICE_LIMIT)
    expect(() => assertMaxDevices(standard, 0)).not.toThrow()
    expectBizError(() => assertMaxDevices(pro, 3), E_DEVICE_LIMIT)
    expect(() => assertMaxDevices(pro, 2)).not.toThrow()
    expectBizError(() => assertMaxDevices(null, 1), E_DEVICE_LIMIT)
  })
})
