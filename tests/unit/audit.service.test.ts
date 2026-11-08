import { describe, expect, it } from 'vitest'
import * as audit from '../../src/main/services/audit/audit.service'
import { openMemDb } from '../helpers/mem-db'

describe('audit.service', () => {
  it('records operator, action and before/after summaries, newest first', () => {
    const db = openMemDb()
    const svc = audit.createAuditService(db)
    svc.record('price.update', 'owner', 'SKU-1', '12.00', '13.00')
    svc.record('data.export', 'cashier', 'goods')
    expect(svc.list().map(({ action, operator, detail, before_value, after_value }) =>
      [action, operator, detail, before_value, after_value]
    )).toEqual([
      ['data.export', 'cashier', 'goods', null, null],
      ['price.update', 'owner', 'SKU-1', '12.00', '13.00']
    ])
  })

  it('query filters by keyword, action and date range with paging', () => {
    const db = openMemDb()
    const svc = audit.createAuditService(db)
    svc.record('user.create', 'owner', '张三')
    svc.record('doc.reverse', 'owner', 'XS0001')
    svc.record('doc.reverse', 'cashier', 'XS0002')
    svc.record('data.export', 'owner', 'goods')

    // keyword 命中 detail 或 operator
    expect(svc.query({ page: 1, pageSize: 10, keyword: '张三' }).total).toBe(1)
    expect(svc.query({ page: 1, pageSize: 10, keyword: 'cashier' }).total).toBe(1)
    // action 过滤
    const q2 = svc.query({ page: 1, pageSize: 10, action: 'doc.reverse' })
    expect(q2.total).toBe(2)
    expect(q2.list.every((r) => r.action === 'doc.reverse')).toBe(true)
    // 日期范围
    const today = new Date().toISOString().slice(0, 10)
    expect(svc.query({ page: 1, pageSize: 10, from: today, to: today }).total).toBe(4)
    expect(svc.query({ page: 1, pageSize: 10, from: '2999-01-01' }).total).toBe(0)
    // 分页
    const p1 = svc.query({ page: 1, pageSize: 2 })
    expect(p1.total).toBe(4)
    expect(p1.list).toHaveLength(2)
    const p2 = svc.query({ page: 2, pageSize: 2 })
    expect(p2.list).toHaveLength(2)
    expect(p2.list[0]?.id).toBeLessThan(p1.list[0]!.id)
  })

  it('list preserves the legacy 100-entry behavior', () => {
    const db = openMemDb()
    const svc = audit.createAuditService(db)
    for (let i = 0; i < 120; i++) svc.record('data.export', 'u', `#${i}`)
    expect(svc.list()).toHaveLength(100)
  })
})

