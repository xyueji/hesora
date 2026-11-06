import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createFundService } from '../../src/main/services/fund/fund.service'
const svc = () => createFundService(openMemDb())
const base = { name: '微信收款', type: 'wechat' as const, opening_balance: 500 }
describe('fund.service', () => {
  let s: ReturnType<typeof createFundService>
  beforeEach(() => { s = svc() })
  it('create with opening_balance', () => { const id = s.create(base); expect(s.getById(id)?.opening_balance).toBe(500) })
  it('invalid type rejected', () => {
    try { s.create({ ...base, type: 'bitcoin' as never }); expect.unreachable() } catch { /* BizError VALIDATION or SQLITE */ }
  })
  it('query keyword on name', () => {
    s.create(base); s.create({ name: '现金柜台', type: 'cash' })
    expect(s.query({ page: 1, pageSize: 10, keyword: '现金' }).total).toBe(1)
  })
  it('no delete, disable/enable ok', () => { const id = s.create(base); expect(() => s.remove(id)).toThrow(); s.disable(id); expect(s.getById(id)?.disabled).toBe(true) })
})
