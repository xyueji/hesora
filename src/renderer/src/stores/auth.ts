import { ref } from 'vue'
import { authApi, type SessionUser } from '../api/auth'
import type { PermissionKey } from '../../../shared/permissions'
import { roleHas } from '../../../shared/permissions'

// 简单模块级响应式认证状态（项目虽配置了 Pinia，此处状态极小，用 ref 即可）
export const currentUser = ref<SessionUser | null>(null)

export async function restoreSession(): Promise<void> {
  currentUser.value = await authApi.current()
}

export function setSession(user: SessionUser | null): void {
  currentUser.value = user
}

export async function logout(): Promise<void> {
  await authApi.logout()
  currentUser.value = null
}

export function hasPermission(perm: PermissionKey): boolean {
  const u = currentUser.value
  if (!u) return false
  // 自定义角色的权限来自会话中的 permissions 清单；内置角色由 roleHas 按预设判定。
  return roleHas(u.role, perm, u.permissions)
}
