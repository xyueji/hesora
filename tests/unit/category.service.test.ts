import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createCategoryService } from '../../src/main/services/setting/category.service'

describe('category.service（收支科目主档）', () => {
  let s: ReturnType<typeof createCategoryService>
  beforeEach(() => { s = createCategoryService(openMemDb()) })

  it('create/list 往返', () => {
    const id = s.create({ name: '水电费', kind: 'expense' })
    const rows = s.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id, name: '水电费', kind: 'expense', disabled: 0 })
  })

  it('重名抛 DUP_CODE', () => {
    s.create({ name: '利息', kind: 'income' })
    expect(() => s.create({ name: '利息', kind: 'income' })).toThrowError(
      expect.objectContaining({ code: 'DUP_CODE' })
    )
  })

  it('kind 非法抛 BizError', () => {
    expect(() => s.create({ name: 'x', kind: 'other' as 'income' })).toThrow()
    expect(() => s.create({ name: '', kind: 'income' })).toThrow()
  })

  it('update 改名；改重名也报 DUP_CODE', () => {
    const a = s.create({ name: 'A', kind: 'income' })
    const b = s.create({ name: 'B', kind: 'income' })
    s.update(a, { name: 'A2', kind: 'expense' })
    expect(s.list()[0]!.name).toBe('A2')
    expect(() => s.update(b, { name: 'A2' })).toThrowError(
      expect.objectContaining({ code: 'DUP_CODE' })
    )
  })

  it('disable/enable 软停用', () => {
    const id = s.create({ name: 'C', kind: 'expense' })
    s.disable(id)
    expect(s.list()[0]!.disabled).toBe(1)
    expect(s.list({ include_disabled: false })).toHaveLength(0)
    s.enable(id)
    expect(s.list({ include_disabled: false })).toHaveLength(1)
  })

  it('remove 物理删除；不存在报 NOT_FOUND', () => {
    const id = s.create({ name: 'D', kind: 'income' })
    s.remove(id)
    expect(s.list()).toHaveLength(0)
    expect(() => s.remove(id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
})
