import type { Result } from '../../../shared/result'

export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  // Vue form values can contain nested reactive proxies. Strip those before
  // Electron tries to clone the argument into the preload context.
  const value: unknown = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
  const result = (await window.api.invoke(channel, value)) as Result<T>
  if (!result.ok) throw new Error(result.msg || result.code)
  return result.data as T
}
