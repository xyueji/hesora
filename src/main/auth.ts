import type { SessionUser } from './services/user/user.service'
import type { PermissionKey } from '../shared/permissions'
import { roleHas } from '../shared/permissions'

// 当前登录用户保存在主进程内存中；应用重启后需重新登录（v1 设计如此）。
let currentUser: SessionUser | null = null

export function setCurrentUser(user: SessionUser | null): void {
  currentUser = user
}

export function getCurrentUser(): SessionUser | null {
  return currentUser
}

/** admin 拥有全部权限；未登录则无任何权限。 */
export function can(permission: PermissionKey): boolean {
  if (!currentUser) return false
  return roleHas(currentUser.role, permission)
}
