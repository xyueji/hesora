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
})
