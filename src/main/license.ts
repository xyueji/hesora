import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { createLicenseService } from './services/license/license.service'

function getWindowsMachineId(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const uuid = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID'
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase()
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(uuid) ||
        /^(?:0|-)+$|^(?:f|-)+$/.test(uuid)) return undefined
    return createHash('sha256').update(`hesora-inventory:${uuid}`).digest('hex')
  } catch {
    return undefined
  }
}

export function createDesktopLicenseService(db: Database) {
  let machineId: string | undefined
  return createLicenseService(db, process.env.HESORA_LICENSE_PUBLIC_KEY?.replace(/\\n/g, '\n'), {
    activationUrl: process.env.HESORA_ACTIVATION_URL,
    machine: () => (machineId ??= getWindowsMachineId())
  })
}
