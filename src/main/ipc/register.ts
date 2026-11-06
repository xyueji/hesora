import { ipcMain } from 'electron'
import { wrapHandler, type IpcHandler } from '../../shared/result'
export function registerIpc(map: Record<string, IpcHandler>): void {
  for (const [channel, handler] of Object.entries(map)) {
    ipcMain.handle(channel, wrapHandler(channel, handler))
  }
}
