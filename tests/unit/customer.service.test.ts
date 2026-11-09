import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
const svc = () => createCustomerService(openMemDb())
const base = { code: 'C001', name: '张三便利店', phone: '13800000000', price_level: 'vip', opening_receivable: 120.5 }
describe('customer.service', () => {
  let s: ReturnType<typeof createCustomerService>
  beforeEach(() => { s = svc() })
  it('create with opening_receivable', () => { const id = s.create(base); expect(s.getById(id)?.opening_receivable).toBe(120.5) })
  it('duplicate code rejected', () => { s.create(base); expect(() => s.create(base)).toThrow() })
  it('query keyword matches name/phone/code', () => {
    s.create(base)
    expect(s.query({ page: 1, pageSize: 10, keyword: '13800' }).total).toBe(1)
  })
  it('cannot delete, can disable', () => { const id = s.create(base); expect(() => s.remove(id)).toThrow(); s.disable(id); expect(s.getById(id)?.disabled).toBe(true) })
  it('update changes fields and enforces DUP_CODE', () => {
    const id = s.create(base); s.create({ ...base, code: 'C002', name: '李四' })
    try { s.update(id, { code: 'C002' }); expect.unreachable() } catch { /* expect DUP_CODE */ }
    s.update(id, { name: '张三超市' }); expect(s.getById(id)?.name).toBe('张三超市')
  })
})

// ── S 级功能批次 B：[4] 邮箱、[8] 分类 ──
describe('customer.service email/category (S 批次 B)', () => {
  let s: ReturnType<typeof createCustomerService>
  beforeEach(() => { s = svc() })

  it('[4] create/update stores email; blank becomes null', () => {
    const id = s.create({ ...base, email: ' a@b.com ' })
    expect(s.getById(id)?.email).toBe('a@b.com')
    s.update(id, { email: '' })
    expect(s.getById(id)?.email).toBeUndefined()
  })

  it('[4] invalid email rejected (BizError VALIDATION)', () => {
    expect(() => s.create({ ...base, email: 'no-at-mark' })).toThrow(/邮箱格式不正确/)
    expect(() => s.create({ ...base, email: '@bad.com' })).toThrow(/邮箱格式不正确/)
    expect(() => s.create({ ...base, email: 'bad@' })).toThrow(/邮箱格式不正确/)
    expect(() => s.create({ ...base, email: 'a b@c.com' })).toThrow(/邮箱格式不正确/)
  })

  it('[8] create/update stores category; query filters by category', () => {
    const id1 = s.create({ ...base, category: 'VIP' })
    s.create({ ...base, code: 'C002', name: '李四', category: '批发' })
    s.create({ ...base, code: 'C003', name: '王五' })
    expect(s.getById(id1)?.category).toBe('VIP')
    expect(s.query({ page: 1, pageSize: 10, category: 'VIP' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10, category: '批发' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10 }).total).toBe(3)
    s.update(id1, { category: '普通' })
    expect(s.getById(id1)?.category).toBe('普通')
  })
})
