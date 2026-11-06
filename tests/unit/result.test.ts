import { describe, it, expect } from 'vitest'
import { ok, fail, wrapHandler, BizError } from '../../src/shared/result'
describe('result', () => {
  it('ok wraps data', () => expect(ok(1)).toEqual({ ok: true, code: 'OK', msg: '', data: 1 }))
  it('fail carries code', () => expect(fail('DUP_CODE', '编码重复')).toEqual({ ok: false, code: 'DUP_CODE', msg: '编码重复', data: null }))
  it('wrapHandler catches thrown errors', async () => {
    const wrapped = wrapHandler('test', async () => { throw new Error('boom') })
    const r = await wrapped(null, {})
    expect(r.ok).toBe(false); expect(r.code).toBe('E_TEST'); expect(r.msg).toContain('boom')
  })
  it('wrapHandler returns ok with handler result', async () => {
    const wrapped = wrapHandler('add', (evt, p) => { void evt; return (p as { a: number }).a + 1 })
    const r = await wrapped(null, { a: 41 })
    expect(r).toMatchObject({ ok: true, data: 42 })
  })
  it('BizError maps to its own code', async () => {
    const wrapped = wrapHandler('x', () => { throw new BizError('DUP_CODE', '编码重复') })
    const r = await wrapped(null, {})
    expect(r).toMatchObject({ ok: false, code: 'DUP_CODE', msg: '编码重复' })
  })
})
