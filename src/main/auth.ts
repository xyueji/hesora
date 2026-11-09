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

/** admin 拥有全部权限；未登录则无任何权限。自定义角色按其权限清单判定。 */
export function can(permission: PermissionKey): boolean {
  if (!currentUser) return false
  return roleHas(currentUser.role, permission, currentUser.permissions)
}

/** 按 userId 判定权限（LAN 网关路径用，不依赖全局 currentUser）。未知用户→false。 */
export function canFor(userId: number, permission: PermissionKey): boolean {
  const u = getUserById(userId)
  return !!u && roleHas(u.role, permission, u.permissions)
}

/**
 * 按 id 读取用户会话：默认（未安装查找器）只匹配内存 currentUser（LAN 未接入时语义安全）。
 * 主进程启动时由 installUserLookup 注入基于库的查找（同 user.service sessionById 语义）。
 */
export function getUserById(userId: number): SessionUser | null {
  if (userLookup) return userLookup(userId)
  return getCurrentUser()?.id === userId ? getCurrentUser() : null
}

let userLookup: ((userId: number) => SessionUser | null) | null = null

/** 安装基于数据库的 userId→SessionUser 查找（main 启动时调用一次；测试可注入内存实现）。 */
export function installUserLookup(fn: (userId: number) => SessionUser | null): void {
  userLookup = fn
}
