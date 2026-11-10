import type { Result } from '../../../shared/result'

/**
 * 渲染层业务错误：携带后端 BizError 的错误码（src/shared/result.ts fail 的 code）。
 * 各视图可按 code 做差异化分支（如 NOT_ENOUGH 定位库存、会话失效重新登录）；
 * 未匹配的 code 继续走 message 兜底展示。
 */
export class BizApiError extends Error {
  /** 后端错误码，如 NOT_ENOUGH / E_AUTH_FAILED / VALIDATION */
  readonly code: string

  constructor(code: string, msg: string) {
    super(msg)
    this.name = 'BizApiError'
    this.code = code
  }
}

export function isBizApiError(e: unknown): e is BizApiError {
  return e instanceof BizApiError
}

export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  // Vue form values can contain nested reactive proxies. Strip those before
  // Electron tries to clone the argument into the preload context.
  const value: unknown = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
  // 渲染层经 preload 注入的 window.api 调用 IPC；用 unknown 收窄以兼容无 DOM lib 的 tsc 工程。
  const host = (globalThis as unknown as { api: { invoke: (c: string, p?: unknown) => Promise<unknown> } }).api
  const result = (await host.invoke(channel, value)) as Result<T>
  if (!result.ok) throw new BizApiError(result.code, result.msg || result.code)
  return result.data as T
}
