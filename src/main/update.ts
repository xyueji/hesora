import { app, shell } from 'electron'
import { registerIpc } from './ipc/register'
import { createUpdateService } from './services/update/update.service'

export function registerUpdateIpc(): void {
  const updateUrl = process.env.HESORA_UPDATE_URL || ''
  const svc = createUpdateService({ currentVersion: app.getVersion(), updateUrl })
  let allowedUrl: string | undefined
  registerIpc({
    'update:check': async () => {
      let configured = false
      try {
        const url = new URL(updateUrl)
        configured = url.protocol === 'https:' && !url.username && !url.password
      } catch {
        // Builds can omit the update endpoint.
      }
      const result = configured ? await svc.check() : { hasUpdate: false }
      allowedUrl = result.downloadUrl
      return result
    },
    'update:openUrl': async (_event, url) => {
      if (!allowedUrl || url !== allowedUrl) return false
      await shell.openExternal(allowedUrl)
      return true
    }
  })
}
