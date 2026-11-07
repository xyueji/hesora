import { call } from './call'
import type { PermissionKey } from '../../../shared/permissions'

export interface SessionUser {
  id: number
  username: string
  role: string
  /** 自定义角色名称；内置角色为 undefined */
  roleName?: string
  /** 自定义角色的权限清单；内置角色为 undefined（由 roleHas 按内置预设判定） */
  permissions?: PermissionKey[]
}

export const authApi = {
  setupStatus: () => call<{ required: boolean; username?: string }>("auth:setupStatus"),
  setup: (username: string, password: string) => call<SessionUser>("auth:setup", { username, password }),
  login: (username: string, password: string) =>
    call<SessionUser | null>('auth:login', { username, password }),
  current: () => call<SessionUser | null>('auth:current'),
  logout: () => call<boolean>('auth:logout')
}
