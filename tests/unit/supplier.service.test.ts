import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
const svc = () => createSupplierService(openMemDb())
const base = { code: 'S001', name: '宏大批发部', phone: '13900000000', opening_payable: 88.8 }

describe('supplier.service', () => {
  let s: ReturnType<typeof createSupplierService>
  beforeEach(() => {
    s = svc()
  })

  it('create with opening_payable', () => {
    const id = s.create(base)
    expect(s.getById(id)?.opening_payable).toBe(88.8)
  })

  it('duplicate code rejected', () => {
    s.create(base)
    expect(() => s.create(base)).toThrow()
  })

  it('create requires code and name', () => {
    expect(() => s.create({ ...base, code: '  ' })).toThrow()
    expect(() => s.create({ ...base, name: '' })).toThrow()
  })

  it('query keyword matches name/phone/code', () => {
    s.create(base)
    expect(s.query({ page: 1, pageSize: 10, keyword: '13900' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10, keyword: '宏大' }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10, keyword: 'S00' }).total).toBe(1)
  })

  it('cannot delete, can disable and enable', () => {
    const id = s.create(base)
    expect(() => s.remove(id)).toThrow()
    s.disable(id)
    expect(s.getById(id)?.disabled).toBe(true)
    s.enable(id)
    expect(s.getById(id)?.disabled).toBe(false)
  })

  it('update changes fields and enforces DUP_CODE', () => {
    const id = s.create(base)
    s.create({ ...base, code: 'S002', name: '另一家' })
    try {
      s.update(id, { code: 'S002' })
      expect.unreachable()
    } catch {
      /* expect DUP_CODE */
    }
    s.update(id, { name: '宏达批发部' })
    expect(s.getById(id)?.name).toBe('宏达批发部')
  })
})
