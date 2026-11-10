// v1.4 多仓门控测试：warehouse:create 第二仓 / transfer:create 多仓调拨 → E_FEATURE_PRO；
// 首仓 create、update/disable/set-default、单仓 transfer 不受限。
import { describe, it, expect, beforeEach } from 'vitest'
import { buildAllHandlers, type HandlerDeps } from '../../src/main/ipc/handlers'
import { openMemDb } from '../helpers/mem-db'
import type { LicensePayload } from '../../src/shared/license'
import { E_FEATURE_PRO } from '../../src/main/services/license-gate'

const memDb = openMemDb() as unknown as import('../../src/main/db').DB
const auditStub = { record: () => {}, list: () => [], query: () => [] } as never

function makeDeps(licensePayload: () => LicensePayload | null): HandlerDeps {
  return {
    getDb: () => memDb,
    productImagesDir: () => '/tmp/x',
    attachmentsDir: () => '/tmp/x',
    resetDemoData: () => false,
    licenseSvc: (() => ({ getStatus: () => { throw new Error('not called') }, activate: () => { throw new Error('not called') } })) as never,
    licensePayload,
    auditSvc: () => auditStub
  }
}

function handlerFor(channel: string, deps: HandlerDeps): (evt: unknown, payload: unknown, session?: unknown) => unknown {
  const h = buildAllHandlers(deps).find((x) => x.channel === channel)
  if (!h) throw new Error(`channel ${channel} not found`)
  return h.handler as typeof h.handler
}

const standardPayload = (): LicensePayload | null => ({ customer: 'c', issuedAt: '2026-11-01' })
const proPayload = (): LicensePayload | null => ({
  customer: 'c', issuedAt: '2026-11-01', edition: 'professional',
  features: ['multi_warehouse', 'rbac']
})

beforeEach(() => {
  memDb.prepare('DELETE FROM warehouse').run()
})

describe('multi-warehouse license gate', () => {
  it('standard: first warehouse:create allowed, second rejected E_FEATURE_PRO', () => {
    const deps = makeDeps(standardPayload)
    const create = handlerFor('warehouse:create', deps)
    expect(() => create(null, { name: '主仓', is_default: true })).not.toThrow()
    try {
      create(null, { name: '二仓' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code: string }).code).toBe(E_FEATURE_PRO)
    }
  })

  it('professional: multiple warehouse:create allowed', () => {
    const deps = makeDeps(proPayload)
    const create = handlerFor('warehouse:create', deps)
    expect(() => create(null, { name: '主仓' })).not.toThrow()
    expect(() => create(null, { name: '二仓' })).not.toThrow()
  })

  it('standard: warehouse:update / disable not gated', () => {
    const deps = makeDeps(standardPayload)
    const create = handlerFor('warehouse:create', deps)
    const id = create(null, { name: '主仓' }) as number
    expect(() => handlerFor('warehouse:update', deps)(null, { id, p: { address: 'x' } })).not.toThrow()
    // 默认仓不允许停用（业务规则）——改测非默认仓，或断言错误码不是门控错误
    try { handlerFor('warehouse:disable', deps)(null, id) } catch (e) {
      expect((e as { code: string }).code).not.toBe(E_FEATURE_PRO)
    }
  })

  it('standard: transfer:create with >1 active warehouses rejected; single warehouse passes validation (NOT gating error)', () => {
    const deps = makeDeps(standardPayload)
    const transfer = handlerFor('transfer:create', deps)
    // 单仓：门控放行，业务校验（items 空 → VALIDATION）先行于/不同于门控错误
    try { transfer(null, { items: [] }); throw new Error('should throw something') } catch (e) {
      expect((e as { code: string }).code).toBe('VALIDATION')
    }
    // 造第二个有效仓（连同首仓共 2 个）
    memDb.prepare("INSERT INTO warehouse (code, name, is_default, disabled) VALUES ('W1', '一仓', 1, 0)").run()
    memDb.prepare("INSERT INTO warehouse (code, name, is_default, disabled) VALUES ('W2', '二仓', 0, 0)").run()
    try {
      transfer(null, { warehouse_id: 1, warehouse_in_id: 2, items: [{ product_id: 1, qty: 1 }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code: string }).code).toBe(E_FEATURE_PRO)
    }
  })
})
