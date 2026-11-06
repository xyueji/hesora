import type { Result } from '../../../shared/result'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const settingApi = {
  get: (key: string) => call<string | null>('setting:get', key),
  set: (key: string, value: string) => call<void>('setting:set', { key, value }),
  getAll: () => call<Record<string, string>>('setting:getAll'),
  remove: (key: string) => call<void>('setting:remove', key)
}
