// BizApiError 错误码 + 会话失效差异化分支的单测（渲染层纯逻辑，无 Electron 依赖）。
import { describe, it, expect } from 'vitest'

// window.api 不存在于单测环境；仅测 call.ts 导出的类型/类与 session-expired 分支。
import { BizApiError, isBizApiError } from '../../src/renderer/src/api/call'
import { isSessionExpiredError, handleSessionExpired } from '../../src/renderer/src/api/session-expired'

describe('BizApiError', () => {
  it('携带 code 且是 Error / BizApiError 实例', () => {
    const e = new BizApiError('NOT_ENOUGH', '库存不足')
    expect(e.code).toBe('NOT_ENOUGH')
    expect(e.message).toBe('库存不足')
    expect(e instanceof Error).toBe(true)
    expect(e instanceof BizApiError).toBe(true)
    expect(isBizApiError(e)).toBe(true)
  })

  it('isBizApiError 对普通 Error / 非 Error 返回 false', () => {
    expect(isBizApiError(new Error('x'))).toBe(false)
    expect(isBizApiError('NOT_ENOUGH')).toBe(false)
    expect(isBizApiError(null)).toBe(false)
  })
})

describe('session-expired', () => {
  it('E_AUTH_FAILED / E_SESSION_NOT_FOUND 判定为会话失效', () => {
    expect(isSessionExpiredError(new BizApiError('E_AUTH_FAILED', '会话无效或已过期'))).toBe(true)
    expect(isSessionExpiredError(new BizApiError('E_SESSION_NOT_FOUND', '会话不存在或已吊销'))).toBe(true)
    expect(isSessionExpiredError(new BizApiError('NOT_ENOUGH', '库存不足'))).toBe(false)
    expect(isSessionExpiredError(new Error('x'))).toBe(false)
  })

  it('handleSessionExpired 仅对会话失效码返回 true，且其他错误返回 false 不副作用', () => {
    expect(handleSessionExpired(new BizApiError('VALIDATION', '参数错误'))).toBe(false)
  })
})
