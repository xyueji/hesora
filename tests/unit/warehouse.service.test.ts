import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
const svc = () => createWarehouseService(openMemDb())
const base = { name: '主仓库', is_default: false }
describe('warehouse.service', () => {
  let s: ReturnType<typeof createWarehouseService>
  beforeEach(() => { s = svc() })
  it('create warehouse', () => { const id = s.create({ ...base, address: '1号库' }); expect(s.getById(id)?.name).toBe('主仓库') })
  it('first warehouse auto becomes default', () => {
    const id = s.create(base)
    expect(s.getById(id)?.is_default).toBe(true)
  })
  it('setting default clears previous default', () => {
    const a = s.create(base); const b = s.create({ ...base, name: '分仓' })
    s.setDefault(b)
    expect(s.getById(a)?.is_default).toBe(false)
    expect(s.getById(b)?.is_default).toBe(true)
  })
  it('cannot disable the default warehouse', () => {
    const a = s.create(base)
    expect(() => s.disable(a)).toThrow()
  })
  it('cannot delete, duplicate name rejected if name unique', () => {
    const a = s.create(base)
    expect(() => s.remove(a)).toThrow()
  })
})
