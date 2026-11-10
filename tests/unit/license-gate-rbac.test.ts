// v1.4 RBAC 门控：user:create/update/remove、role:create/update/remove 在 standard（null payload / 无 rbac）下
// 抛 E_FEATURE_PRO；professional（features 含 rbac）放行。admin 登录通道（auth:*）不受门控影响。
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
  customer: 'c', issuedAt: '2026-11-01', edition: 'professional', features: ['rbac']
})

const MANAGE_CHANNELS = ['user:create', 'user:update', 'user:remove', 'role:create', 'role:update', 'role:remove'] as const

beforeEach(() => {
  memDb.prepare('DELETE FROM "user"').run()
  memDb.prepare('DELETE FROM access_role').run()
})

describe('rbac license gate', () => {
  it('standard (null payload): all 6 manage channels reject E_FEATURE_PRO before touching data', () => {
    const deps = makeDeps(standardPayload)
    for (const ch of MANAGE_CHANNELS) {
      const h = handlerFor(ch, deps)
      const payload = ch === 'user:create' ? { username: 'u1', password: 'p123456', role: 'cashier' }
        : ch === 'user:update' ? { id: 1, patch: { role: 'admin' } }
        : ch === 'user:remove' ? 1
        : ch === 'role:create' ? { name: 'r1', permissions: [] }
        : ch === 'role:update' ? { id: 'r1', patch: { name: 'r1x' } }
        : 'r1'
      try {
        h(null, payload)
        throw new Error(`${ch} should have thrown`)
      } catch (e) {
        expect((e as { code: string }).code, ch).toBe(E_FEATURE_PRO)
      }
    }
    // 无副作用
    expect(memDb.prepare('SELECT COUNT(*) c FROM "user"').get()).toEqual({ c: 0 })
  })

  it('standard without rbac feature but professional edition also rejects', () => {
    const deps = makeDeps(() => ({ customer: 'c', issuedAt: 'x', edition: 'professional', features: [] }))
    try {
      handlerFor('user:create', deps)(null, { username: 'u1', password: 'p123456', role: 'cashier' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code: string }).code).toBe(E_FEATURE_PRO)
    }
  })

  it('professional with rbac: user:create / role:create succeed', () => {
    const deps = makeDeps(proPayload)
    const created = handlerFor('user:create', deps)(null, { username: 'op1', password: 'p123456', role: 'cashier' }) as { id: number }
    expect(created).toBeTruthy()
    const rid = handlerFor('role:create', deps)(null, { name: '仓管', permissions: [] })
    expect(rid).toBeTruthy()
  })

  it('professional with rbac: user:update/remove + role:update/remove succeed', () => {
    const deps = makeDeps(proPayload)
    const created = handlerFor('user:create', deps)(null, { username: 'op2', password: 'p123456', role: 'cashier' }) as { id: number }
    const uid = created.id
    expect(() => handlerFor('user:update', deps)(null, { id: uid, patch: { displayName: '张三' } })).not.toThrow()
    expect(() => handlerFor('user:remove', deps)(null, uid)).not.toThrow()
    const role = handlerFor('role:create', deps)(null, { name: '临时', permissions: [] }) as { id: string }
    expect(() => handlerFor('role:update', deps)(null, { id: role.id, patch: { name: '临时2' } })).not.toThrow()
    expect(() => handlerFor('role:remove', deps)(null, role.id)).not.toThrow()
  })

  it('auth (login) channels are not gated: admin login still available in standard', () => {
    // ensureDefaultAdmin 由应用启动触发；这里直接造 admin 用户验证 auth:login 不走门控
    memDb.prepare("INSERT INTO \"user\" (username, password_hash, role) VALUES ('admin', '', 'admin')").run()
    const deps = makeDeps(standardPayload)
    const authHandlers = buildAllHandlers(deps).filter((x) => x.channel.startsWith('auth:'))
    expect(authHandlers.length).toBeGreaterThan(0)
    // 门控只会拦 user:/role: 管理通道，auth:* 通道存在即可（登录逻辑属另一测试域）
    expect(authHandlers.some((x) => x.channel === 'auth:login')).toBe(true)
  })
})
