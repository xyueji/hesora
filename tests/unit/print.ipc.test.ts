import { expect, it, vi } from 'vitest'
import { createPrintIpc } from '../../src/main/print'
import { openMemDb } from '../helpers/mem-db'

const electron = vi.hoisted(() => ({
  print: vi.fn<(options: Electron.WebContentsPrintOptions, callback: (success: boolean, reason: string) => void) => void>(),
  destroy: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { print: electron.print }
    isDestroyed = () => false
    destroy = electron.destroy
    loadURL = electron.loadURL
  }
}))

it('keeps the thermal print window alive until the device callback and surfaces failure', async () => {
  const db = openMemDb()
  db.exec("INSERT INTO doc (id, no, type, date) VALUES (1, 'LS1', 'retail', '2026-11-07')")
  const result = createPrintIpc(db).printReceipt(1, 'Thermal', 80)
  await vi.waitFor(() => expect(electron.print).toHaveBeenCalledTimes(1))
  expect(electron.destroy).not.toHaveBeenCalled()
  const [options, callback] = electron.print.mock.calls[0]!
  expect(options).toMatchObject({ silent: true, deviceName: 'Thermal' })
  expect(decodeURIComponent(electron.loadURL.mock.calls[0]?.[0])).toContain('80mm')
  callback(false, '设备离线')
  await expect(result).rejects.toMatchObject({ code: 'PRINT_FAILED', message: '小票打印失败：设备离线' })
  expect(electron.destroy).toHaveBeenCalledOnce()
  db.close()
})
