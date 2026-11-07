import { call } from './call'
import type { AccessRole, PermissionKey } from '../../../shared/permissions'

export interface SafeUser {
  id: number
  username: string
  /** 内置角色为 'admin' / 'cashier'；自定义角色为角色 id */
  role: string
  /** 角色显示名 */
  role_name: string
  disabled: number
  created_at: string
  updated_at: string | null
}

export const userApi = {
  query: () => call<SafeUser[]>('user:query'),
  create: (data: { username: string; password: string; role: string }) =>
    call<SafeUser>('user:create', data),
  update: (
    id: number,
    patch: { password?: string; role?: string; disabled?: number | boolean }
  ) => call<SafeUser>('user:update', { id, patch }),
  remove: (id: number) => call<boolean>('user:remove', id)
}

export const roleApi = {
  list: () => call<AccessRole[]>('role:list'),
  create: (data: { name: string; permissions: PermissionKey[] }) =>
    call<AccessRole>('role:create', data),
  update: (id: string, patch: { name?: string; permissions?: PermissionKey[] }) =>
    call<AccessRole>('role:update', { id, patch }),
  remove: (id: string) => call<boolean>('role:remove', id)
}
