import { call } from './call'

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
