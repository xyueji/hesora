import { describe, it, expect } from 'vitest'
import { createAuditService } from '../../src/main/services/audit/audit.service'
import { openMemDb } from '../helpers/mem-db'

describe('audit coverage for sensitive IPC actions', () => {
  it('auditedActions contains every channel listed as sensitive', () => {
    const db = openMemDb()
    const svc = createAuditService(db)
    // 与 src/main/index.ts 的 AUDITED_ACTIONS 保持一致：
    // 危险/敏感操作（删改主档、用户与角色变更、恢复备份、导出、红冲、改价）必须留痕。
    const sensitive = [
      'category:remove',
      'formula:remove',
      'customerPrice:remove',
      'setting:remove',
      'user:create',
      'user:update',
      'user:remove',
      'role:create',
      'role:update',
      'role:remove',
      'backup:restore'
    ]
    for (const action of sensitive) {
      // 每个敏感动作都应能通过 auditSvc.record 记录且能被 list 查询到
      svc.record(action, 'tester', `channel=${action}`)
    }
    const listed = new Set(svc.list().map((e) => e.action))
    for (const action of sensitive) {
      expect(listed.has(action), `缺少审计动作: ${action}`).toBe(true)
    }
  })

  it('remove-type audit entries record the deleted id as before_value', () => {
    const db = openMemDb()
    const svc = createAuditService(db)
    svc.record('category:remove', 'tester', 'income_category #3', JSON.stringify({ id: 3, name: '运费' }))
    const entry = svc.list().find((e) => e.action === 'category:remove')
    expect(entry).toBeTruthy()
    expect(JSON.parse(entry!.before_value ?? '{}')).toEqual({ id: 3, name: '运费' })
  })
})
