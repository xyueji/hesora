import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createUserService } from '../../src/main/services/user/user.service'
import { BizError } from '../../src/shared/result'

describe('user.service', () => {
  it('verify ok / wrong password / unknown / disabled', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    const u = svc.create({ username: 'li', password: 'pw123456', role: 'cashier' })
    expect(svc.verify('li', 'pw123456')).toEqual({ id: u.id, username: 'li', role: 'cashier' })
    expect(svc.verify('li', 'wrong')).toBeNull()
    expect(svc.verify('nobody', 'x')).toBeNull()
    svc.update(u.id, { disabled: true })
    expect(svc.verify('li', 'pw123456')).toBeNull()
  })

  it('create validates empty username/password and role enum, DUP_CODE on duplicate', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    expect(() => svc.create({ username: '', password: 'pw123456', role: 'cashier' })).toThrow(BizError)
    expect(() => svc.create({ username: 'a', password: '', role: 'cashier' })).toThrow(BizError)
    expect(() => svc.create({ username: 'a', password: 'pw123456', role: 'boss' as never })).toThrow(BizError)
    svc.create({ username: 'a', password: 'pw123456', role: 'cashier' })
    expect(() => svc.create({ username: 'a', password: 'pw123456', role: 'cashier' })).toThrowError(
      expect.objectContaining({ code: 'DUP_CODE' })
    )
  })

  it('update rehashes password and changes role', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    const u = svc.create({ username: 'a', password: 'old12345', role: 'cashier' })
    svc.update(u.id, { password: 'new12345', role: 'admin' })
    const v = svc.verify('a', 'new12345')
    expect(v?.role).toBe('admin')
    expect(svc.verify('a', 'old12345')).toBeNull()
  })

  it('prevents disabling the last admin', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    svc.setupAdmin('admin', 'secret-123')
    const admin = svc.query().find((u) => u.role === 'admin')!
    expect(() => svc.update(admin.id, { disabled: true })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION', message: '至少保留一个管理员' })
    )
  })

  it('allows disabling admin when another admin exists', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    const a1 = svc.create({ username: 'a1', password: 'pw123456', role: 'admin' })
    svc.create({ username: 'a2', password: 'pw123456', role: 'admin' })
    svc.update(a1.id, { disabled: true })
    expect(svc.verify('a1', 'pw123456')).toBeNull()
  })

  it('remove prevents removing the last admin, allows others', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    svc.setupAdmin('admin', 'secret-123')
    const admin = svc.query().find((u) => u.role === 'admin')!
    expect(() => svc.remove(admin.id)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' })
    )
    const cashier = svc.create({ username: 'c', password: 'pw123456', role: 'cashier' })
    svc.remove(cashier.id)
    expect(svc.query().map((u) => u.username)).not.toContain('c')
  })

  it('query returns users without password hashes', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    svc.create({ username: 'a', password: 'pw123456', role: 'cashier' })
    for (const u of svc.query()) {
      expect('password_hash' in u).toBe(false)
      expect('passwordHash' in u).toBe(false)
    }
  })
})

it('creates an administrator only after first-run setup supplies a strong password', () => {
  const svc = createUserService(openMemDb())
  expect(svc.setupStatus()).toEqual({ required: true })
  expect(() => svc.setupAdmin('owner', '123456')).toThrow()
  expect(svc.setupAdmin('owner', 'first-run-secret').role).toBe('admin')
  expect(svc.setupStatus()).toEqual({ required: false })
  expect(() => svc.setupAdmin('new-owner', 'first-run-secret')).toThrow()
})

it('does not accept the published default password on an existing installation', () => {
  const svc = createUserService(openMemDb())
  const owner = svc.create({ username: 'admin', password: 'admin123', role: 'admin' })
  expect(svc.verify('admin', 'admin123')).toBeNull()
  expect(svc.setupStatus()).toEqual({ required: true, username: 'admin' })
  expect(svc.setupAdmin('admin', 'changed-secret').id).toBe(owner.id)
  expect(svc.verify('admin', 'changed-secret')?.id).toBe(owner.id)
})

it('keeps the last active administrator when another admin is disabled', () => {
  const svc = createUserService(openMemDb())
  const active = svc.create({ username: 'a1', password: 'secret-123', role: 'admin' })
  const inactive = svc.create({ username: 'a2', password: 'secret-123', role: 'admin' })
  svc.update(inactive.id, { disabled: true })
  expect(() => svc.remove(active.id)).toThrow(/至少保留一个管理员/)
})

it('assigns a custom role and refreshes its exact permission set', () => {
  const svc = createUserService(openMemDb())
  const role = svc.createRole({ name: '仓库主管', permissions: ['inventory.view', 'inventory.adjust'] })
  const user = svc.create({ username: 'warehouse', password: 'secret-123', role: role.id })
  const session = svc.verify('warehouse', 'secret-123')
  expect(session?.roleName).toBe('仓库主管')
  expect(svc.can(session, 'inventory.adjust')).toBe(true)
  expect(svc.can(session, 'data.export')).toBe(false)
  svc.updateRole(role.id, { permissions: ['inventory.view'] })
  expect(svc.can(svc.sessionById(user.id), 'inventory.adjust')).toBe(false)
  expect(() => svc.removeRole(role.id)).toThrow(/操作员/)
  svc.update(user.id, { role: 'cashier' })
  svc.removeRole(role.id)
  expect(svc.listRoles().map(({ id }) => id)).toEqual(['admin', 'cashier'])
})

it('protects built-in roles and rejects undefined or privileged grants', () => {
  const svc = createUserService(openMemDb())
  expect(() => svc.removeRole('admin')).toThrow(/内置/)
  expect(() => svc.updateRole('cashier', { name: 'everyone' })).toThrow(/内置/)
  expect(() => svc.createRole({ name: '坏权限', permissions: ['unregistered' as never] })).toThrow()
  expect(() => svc.createRole({ name: '超级角色', permissions: ['system.role'] })).toThrow()
  expect(() => svc.createRole({ name: '提权角色', permissions: ['system.user'] })).toThrow()
  expect(() => svc.createRole({ name: '管理员', permissions: [] })).toThrow(/已存在/)
  expect(svc.can({ id: 1, username: 'a', role: 'admin' }, 'unregistered' as never)).toBe(false)
})

it('cannot demote the sole administrator to a custom role', () => {
  const svc = createUserService(openMemDb())
  const admin = svc.setupAdmin('admin', 'strong-password')
  const role = svc.createRole({ name: '库管', permissions: [] })
  expect(() => svc.update(admin.id, { role: role.id })).toThrow(/至少保留一个管理员/)
})
