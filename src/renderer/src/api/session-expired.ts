// 会话失效统一处理：LAN 网关在会话无效/过期时返回 E_AUTH_FAILED（src/main/host/server.ts），
// 主机端配对会话吊销返回 E_SESSION_NOT_FOUND（src/main/host/auth.ts）。
// 收到这类错误码时清空本地会话并跳转登录页，与路由守卫（未登录一律回 /login）行为一致。
import { ElMessage } from 'element-plus'
import { setSession } from '../stores/auth'
import { isBizApiError } from './call'

export const SESSION_EXPIRED_CODES = ['E_AUTH_FAILED', 'E_SESSION_NOT_FOUND'] as const

export function isSessionExpiredError(e: unknown): boolean {
  return isBizApiError(e) && (SESSION_EXPIRED_CODES as readonly string[]).includes(e.code)
}

let handling = false

/** 会话失效 → 清空本地会话、提示并跳转登录页（防抖避免轮询期间重复弹跳）。返回是否按会话失效处理。 */
export function handleSessionExpired(e: unknown): boolean {
  if (!isSessionExpiredError(e) || handling) return false
  handling = true
  setSession(null)
  ElMessage.warning('登录已失效，请重新登录')
  // 应用路由为 createWebHashHistory：直接改 hash 触发导航，等价 router.push('/login')，
  // 且避免在本模块静态依赖 router（防止 node 侧 typecheck 传递解析 .vue 模块）。
  ;(globalThis as unknown as { location: { hash: string } }).location.hash = '#/login'
  setTimeout(() => {
    handling = false
  }, 500)
  return true
}
