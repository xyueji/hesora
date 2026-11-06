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

export interface SafeUser {
  id: number
  username: string
  role: 'admin' | 'cashier'
  disabled: number
  created_at: string
  updated_at: string | null
}

export const userApi = {
  query: () => call<SafeUser[]>('user:query'),
  create: (data: { username: string; password: string; role: 'admin' | 'cashier' }) =>
    call<SafeUser>('user:create', data),
  update: (
    id: number,
    patch: { password?: string; role?: 'admin' | 'cashier'; disabled?: number | boolean }
  ) => call<SafeUser>('user:update', { id, patch }),
  remove: (id: number) => call<boolean>('user:remove', id)
}
