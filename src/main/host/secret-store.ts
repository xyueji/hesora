// v1.3 Task 8: 设备 secret 持久化（DPAPI / Electron safeStorage）。
// 裁定：主机侧 deviceSecrets 以**DPAPI 加密后明文落盘**（safeStorage.encryptString 的
// 密文 base64 存 userData/host-secrets.json）。DPAPI 绑定当前 Windows 用户，其他用户/
// 拷贝出去的文件解不开；文件本身不是“明文 secret”，落盘裁定见 spec 勘误节。
// safeStorage.isEncryptionAvailable() 为 false（Linux 无 keyring 等）→ 回退不持久化，
// 行为同 T5（重启后设备重新配对），只记日志。
// 本模块禁止 import electron 顶层——由调用方（index.ts）注入 SafeStorageLike，
// 测试可注入 fake（交付项⑤的注入式测试约定）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** electron safeStorage 的最小结构（主进程注入；测试用 fake 实现）。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretStoreDeps {
  /** userData 目录（host-secrets.json 存放处） */
  userDataDir: string
  safeStorage: SafeStorageLike
  log?: (level: 'info' | 'error' | 'warn', msg: string) => void
}

const FILE_NAME = 'host-secrets.json'

interface StoredShape {
  version: 1
  /** deviceId → base64(safeStorage.encryptString(secretHex)) */
  secrets: Record<string, string>
}

function filePath(deps: SecretStoreDeps): string {
  return join(deps.userDataDir, FILE_NAME)
}

function readStore(deps: SecretStoreDeps): StoredShape {
  const p = filePath(deps)
  if (!existsSync(p)) return { version: 1, secrets: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as { version?: unknown; secrets?: unknown }
      if (obj.version === 1 && obj.secrets && typeof obj.secrets === 'object' && !Array.isArray(obj.secrets)) {
        const secrets: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj.secrets)) {
          if (typeof k === 'string' && typeof v === 'string') secrets[k] = v
        }
        return { version: 1, secrets }
      }
    }
    return { version: 1, secrets: {} }
  } catch (e) {
    deps.log?.('warn', `secret store unreadable, starting empty: ${String(e)}`)
    return { version: 1, secrets: {} }
  }
}

/** 持久化是否可用（不可用时 save/load 全部 no-op + 日志，一次判定不反复刷日志）。 */
export function isSecretPersistenceAvailable(deps: SecretStoreDeps): boolean {
  try {
    return deps.safeStorage.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

/** 保存/更新一个设备 secret（加密落盘，原子性：全量重写小文件，3 台设备规模足够）。 */
export function saveDeviceSecret(deps: SecretStoreDeps, deviceId: string, secretHex: string): boolean {
  if (!isSecretPersistenceAvailable(deps)) {
    deps.log?.('warn', 'safeStorage unavailable — device secret NOT persisted (re-pair after restart)')
    return false
  }
  try {
    const store = readStore(deps)
    store.secrets[deviceId] = deps.safeStorage.encryptString(secretHex).toString('base64')
    writeFileSync(filePath(deps), JSON.stringify(store), 'utf8')
    return true
  } catch (e) {
    deps.log?.('error', `saveDeviceSecret failed: ${String(e)}`)
    return false
  }
}

/** 启动时载入全部已持久化 secret（解密失败的单条跳过，不让坏条目拖垮整体）。 */
export function loadDeviceSecrets(deps: SecretStoreDeps): Map<string, string> {
  const out = new Map<string, string>()
  if (!isSecretPersistenceAvailable(deps)) {
    deps.log?.('warn', 'safeStorage unavailable — device secrets NOT loaded (re-pair after restart)')
    return out
  }
  const store = readStore(deps)
  for (const [deviceId, b64] of Object.entries(store.secrets)) {
    try {
      out.set(deviceId, deps.safeStorage.decryptString(Buffer.from(b64, 'base64')))
    } catch (e) {
      deps.log?.('warn', `secret for device ${deviceId} undecryptable, skipped: ${String(e)}`)
    }
  }
  return out
}

/** 设备被 revoke/重新配对时删除持久化条目。 */
export function removeDeviceSecret(deps: SecretStoreDeps, deviceId: string): void {
  if (!isSecretPersistenceAvailable(deps)) return
  try {
    const store = readStore(deps)
    if (deviceId in store.secrets) {
      delete store.secrets[deviceId]
      writeFileSync(filePath(deps), JSON.stringify(store), 'utf8')
    }
  } catch (e) {
    deps.log?.('error', `removeDeviceSecret failed: ${String(e)}`)
  }
}
