import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createUserService } from '../../src/main/services/user/user.service'
import { BizError } from '../../src/shared/result'

describe('user.service', () => {
  it('ensureDefaultAdmin seeds admin/admin123 once and is idempotent', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    svc.ensureDefaultAdmin()
    svc.ensureDefaultAdmin()
    const users = svc.query()
    expect(users).toHaveLength(1)
    expect(users[0]!.username).toBe('admin')
    expect(users[0]!.role).toBe('admin')
    expect(JSON.stringify(users[0])).not.toContain('password')
    const login = svc.verify('admin', 'admin123')
    expect(login).not.toBeNull()
    expect(login?.role).toBe('admin')
  })

  it('ensureDefaultAdmin skips when any user already exists', () => {
    const db = openMemDb()
    const svc = createUserService(db)
    svc.create({ username: 'boss', password: 'pw123456', role: 'admin' })
    svc.ensureDefaultAdmin()
    expect(svc.query().map((u) => u.username)).toEqual(['boss'])
  })

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
    svc.ensureDefaultAdmin()
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
    svc.ensureDefaultAdmin()
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
