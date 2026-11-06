export interface Result<T = unknown> { ok: boolean; code: string; msg: string; data: T | null }
export const ok = <T>(data: T): Result<T> => ({ ok: true, code: 'OK', msg: '', data })
export const fail = (code: string, msg: string): Result<never> => ({ ok: false, code, msg, data: null })
export class BizError extends Error {
  constructor(public code: string, msg: string) { super(msg) }
}
export type IpcHandler = (evt: unknown, payload: unknown) => Promise<unknown> | unknown
export function wrapHandler(channel: string, handler: IpcHandler) {
  return async (evt: unknown, payload: unknown): Promise<Result> => {
    try { return ok(await handler(evt, payload)) }
    catch (e) {
      if (e instanceof BizError) return fail(e.code, e.message)
      return fail(`E_${channel.replace(/[:.]/g, '_').toUpperCase()}`, String((e as Error)?.message ?? e))
    }
  }
}
