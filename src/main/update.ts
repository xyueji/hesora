// 提示式更新主进程接线：thin wrapper。
// UPDATE_URL 为占位地址，发布前请在 README 中说明如何替换为真实 latest.json 地址。
import { app, shell, ipcMain } from 'electron'
import { createUpdateService } from './services/update/update.service'

export const UPDATE_URL = 'https://updates.example.com/zhjs/latest.json'

export function registerUpdateIpc(): void {
  const svc = createUpdateService({ currentVersion: app.getVersion(), updateUrl: UPDATE_URL })
  ipcMain.handle('update:check', async () => svc.check())
  ipcMain.handle('update:openUrl', async (_evt, url: unknown) => {
    const u = String(url ?? '')
    if (!/^https?:\/\//.test(u)) return false
    await shell.openExternal(u)
    return true
  })
}
