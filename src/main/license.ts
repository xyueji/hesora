import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { createLicenseService } from './services/license/license.service'

/**
 * D17（T8 商用闭环）：激活公钥注入机制。
 * 优先级：process.env.HESORA_LICENSE_PUBLIC_KEY（开发覆盖）>
 * resources/license-public-key.txt（打包注入默认值：打包后位于 process.resourcesPath，
 * 开发态位于仓库 resources/）> undefined（走 license.service 内置默认公钥）。
 * electron-builder extraResources 已把该文件打进安装包（见 package.json build.extraResources）。
 */
function loadInjectedPublicKey(): string | undefined {
  const envKey = process.env.HESORA_LICENSE_PUBLIC_KEY?.replace(/\\n/g, '\n').trim()
  if (envKey) return envKey
  const resourceDir = process.resourcesPath ?? join(process.cwd(), 'resources')
  const candidates = [join(resourceDir, 'license-public-key.txt'), join(process.cwd(), 'resources', 'license-public-key.txt')]
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue
      const raw = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
        .trim()
      if (raw && raw.includes('BEGIN') && raw.includes('KEY')) return raw
    } catch {
      // 读不到占位文件就继续下一个候选
    }
  }
  return undefined
}

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
  return createLicenseService(db, loadInjectedPublicKey(), {
    activationUrl: process.env.HESORA_ACTIVATION_URL,
    machine: () => (machineId ??= getWindowsMachineId())
  })
}
