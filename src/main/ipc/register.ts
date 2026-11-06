import { ipcMain } from 'electron'
import { wrapHandler, fail, type IpcHandler } from '../../shared/result'

// permissionOf: 可选的通道权限检查器。返回 false 时拒绝执行并返回 NO_PERMISSION。
// 未提供 permissionOf 时使用全局默认检查器（main/auth 设置）；都没有则不检查。
let defaultPermissionOf: ((channel: string) => boolean) | null = null
export function setDefaultPermissionGuard(fn: (channel: string) => boolean): void {
  defaultPermissionOf = fn
}

export function registerIpc(
  map: Record<string, IpcHandler>,
  permissionOf?: (channel: string) => boolean
): void {
  const check = permissionOf ?? defaultPermissionOf ?? undefined
  for (const [channel, handler] of Object.entries(map)) {
    if (!check) {
      ipcMain.handle(channel, wrapHandler(channel, handler))
      continue
    }
    const wrapped = wrapHandler(channel, handler)
    ipcMain.handle(channel, async (evt, payload) => {
      if (!check(channel)) {
        return fail('NO_PERMISSION', '没有执行此操作的权限')
      }
      return wrapped(evt, payload)
    })
  }
}
