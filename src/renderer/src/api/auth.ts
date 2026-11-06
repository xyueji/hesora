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

export interface SessionUser {
  id: number
  username: string
  role: 'admin' | 'cashier'
}

export const authApi = {
  login: (username: string, password: string) =>
    call<SessionUser | null>('auth:login', { username, password }),
  current: () => call<SessionUser | null>('auth:current'),
  logout: () => call<boolean>('auth:logout')
}
