// v1.4 客户端接线：本机（客户端角色）保存的主机凭据 —— DPAPI 加密落盘。
// 裁定（与主机侧 host-secrets.json 同款策略）：
//  · 敏感项（配对 secret / 证书指纹 / 会话 token）一律经 safeStorage 加密后 base64 落盘；
//  · DPAPI 不可用（safeStorage.isEncryptionAvailable()===false）时**决不明文落盘**，
//    只降级为内存态（本次会话可用，重启后需重新配对）；
//  · 文件独立于主机侧 host-secrets.json（host-scoped key = 主机地址），避免两套语义混在一张表。
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SafeStorageLike } from './secret-store'

export interface ClientCredentialStoreDeps {
  userDataDir: string
  safeStorage: SafeStorageLike
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export interface HostCredential {
  /** 配对 secret（hex） */
  secretHex: string
  /** 主机自签证书指纹 sha256(DER).hex */
  fingerprintHex: string
  /** 会话 token */
  token: string
}

export interface HostCredentialStore {
  /** 持久化是否可用（DPAPI 可用性）。 */
  available(): boolean
  /** 保存（覆盖）某主机地址下的凭据。 */
  save(hostAddress: string, cred: HostCredential): boolean
  /** 读取某主机地址下的凭据（不存在 → 空值）。 */
  load(hostAddress: string): HostCredential
  /** 删除某主机地址下的凭据（忘记主机 / 吊销后重配）。 */
  remove(hostAddress: string): void
}

const FILE_NAME = 'client-credentials.json'

interface StoredShape {
  version: 1
  /** hostAddress → base64(safeStorage.encryptString(JSON.stringify(cred))) */
  hosts: Record<string, string>
}

function filePath(deps: ClientCredentialStoreDeps): string {
  return join(deps.userDataDir, FILE_NAME)
}

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}

function readStore(deps: ClientCredentialStoreDeps): StoredShape {
  const p = filePath(deps)
  if (!existsSync(p)) return { version: 1, hosts: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as { version?: unknown; hosts?: unknown }
      if (obj.version === 1 && obj.hosts && typeof obj.hosts === 'object' && !Array.isArray(obj.hosts)) {
        const hosts: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj.hosts)) {
          if (typeof k === 'string' && typeof v === 'string') hosts[k] = v
        }
        return { version: 1, hosts }
      }
    }
    return { version: 1, hosts: {} }
  } catch (e) {
    deps.log?.('warn', `client credential store unreadable, starting empty: ${String(e)}`)
    return { version: 1, hosts: {} }
  }
}

export function createHostCredentialStore(deps: ClientCredentialStoreDeps): HostCredentialStore {
  function available(): boolean {
    try {
      return deps.safeStorage.isEncryptionAvailable() === true
    } catch {
      return false
    }
  }

  function save(hostAddress: string, cred: HostCredential): boolean {
    if (!available()) {
      deps.log?.('warn', 'safeStorage unavailable — client credential NOT persisted (re-pair after restart)')
      return false
    }
    try {
      const store = readStore(deps)
      const payload = JSON.stringify(cred)
      store.hosts[hostAddress] = deps.safeStorage.encryptString(payload).toString('base64')
      atomicWrite(filePath(deps), JSON.stringify(store))
      return true
    } catch (e) {
      deps.log?.('error', `save client credential failed: ${String(e)}`)
      return false
    }
  }

  function load(hostAddress: string): HostCredential {
    const empty: HostCredential = { secretHex: '', fingerprintHex: '', token: '' }
    if (!available()) return empty
    const store = readStore(deps)
    const b64 = store.hosts[hostAddress]
    if (!b64) return empty
    try {
      const plain = deps.safeStorage.decryptString(Buffer.from(b64, 'base64'))
      const parsed: unknown = JSON.parse(plain)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
      const obj = parsed as { secretHex?: unknown; fingerprintHex?: unknown; token?: unknown }
      return {
        secretHex: typeof obj.secretHex === 'string' ? obj.secretHex : '',
        fingerprintHex: typeof obj.fingerprintHex === 'string' ? obj.fingerprintHex : '',
        token: typeof obj.token === 'string' ? obj.token : ''
      }
    } catch (e) {
      deps.log?.('warn', `client credential undecryptable, skipped: ${String(e)}`)
      return empty
    }
  }

  function remove(hostAddress: string): void {
    if (!available()) return
    try {
      const store = readStore(deps)
      if (hostAddress in store.hosts) {
        delete store.hosts[hostAddress]
        atomicWrite(filePath(deps), JSON.stringify(store))
      }
    } catch (e) {
      deps.log?.('error', `remove client credential failed: ${String(e)}`)
    }
  }

  return { available, save, load, remove }
}
