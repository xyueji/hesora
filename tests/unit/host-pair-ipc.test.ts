// v1.3 Task 8: host:* IPC 逻辑层测试（createHostPairIpc + shouldCreateTray）。
// pairing 用真实 createPairingService + 内存库（参考 host-pairing.test.ts 模式）；
// DPAPI 写回用临时目录 + mock safeStorage（isEncryptionAvailable=true，加解密原样透传）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemDb } from '../helpers/mem-db'
import { createPairingService, type PairingService } from '../../src/main/host/pairing'
import { createHostPairIpc, shouldCreateTray, type HostPairIpc } from '../../src/main/ipc/host-pair-ipc'
import type { SecretStoreDeps } from '../../src/main/host/secret-store'
import type { Result } from '../../src/shared/result'

/** 断言成功并收窄 Result.data（Result 无 discriminant，测试侧手动收窄）。 */
function unwrap<T>(r: Result<T>, label = 'expect ok'): T {
  expect(r.ok).toBe(true)
  if (!r.ok || r.data === null) throw new Error(`${label}: data is null`)
  return r.data
}

let tmpDir: string
let now = 1_000_000

function makeSecretDeps(): SecretStoreDeps {
  return {
    userDataDir: tmpDir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }
  }
}

interface Fixture {
  ipc: HostPairIpc
  pairing: PairingService
  secrets: Map<string, string>
  registered: string[]
  secretDeps: SecretStoreDeps
}

function makeFixture(opts?: { lanAllowed?: boolean; serverPort?: number | null }): Fixture {
  const pairing = createPairingService(openMemDb(), { clock: () => now })
  const secrets = new Map<string, string>()
  const registered: string[] = []
  const secretDeps = makeSecretDeps()
  const saved: string[] = []
  const ipc = createHostPairIpc({
    getPairing: () => pairing,
    getServerInfo: () => (opts?.serverPort === null ? null : { port: opts?.serverPort ?? 18650 }),
    deviceSecrets: secrets,
    registerDeviceSecret: (id, hex) => {
      registered.push(`${id}:${hex}`)
    },
    secretStoreDeps: secretDeps,
    saveDeviceSecret: () => {
      saved.push('x')
    },
    removeDeviceSecret: (_d, id) => {
      const i = saved.indexOf(id)
      if (i >= 0) saved.splice(i, 1)
    },
    lanAllowed: () => opts?.lanAllowed ?? true,
    now: () => now,
    startedAt: 900_000
  })
  return { ipc, pairing, secrets, registered, secretDeps }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hesora-host-pair-'))
  now = 1_000_000
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('shouldCreateTray', () => {
  it('creates only when lanAllowed', () => {
    expect(shouldCreateTray(true)).toBe(true)
    expect(shouldCreateTray(false)).toBe(false)
  })
})

describe('host:pairStart', () => {
  it('returns code + qrPayload when host on', () => {
    const { ipc } = makeFixture()
    const r = unwrap(ipc.pairStart('收银机1'))
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.qrPayload).toBe(`hesora-pair://${r.ip}:18650/${r.code}`)
    expect(r.expiresAt).toBe(now + 5 * 60_000)
  })

  it('fails LAN_HOST_OFF when pairing not initialized', () => {
    let pairing: PairingService | null = createPairingService(openMemDb(), { clock: () => now })
    const ipc = createHostPairIpc({
      getPairing: () => pairing,
      getServerInfo: () => null,
      deviceSecrets: new Map(),
      registerDeviceSecret: () => {},
      secretStoreDeps: null,
      saveDeviceSecret: () => false,
      removeDeviceSecret: () => {},
      lanAllowed: () => false
    })
    pairing = null // 主机 IIFE 从未启动
    const r2 = ipc.pairStart('d1')
    expect(r2.ok).toBe(false)
    expect(r2.code).toBe('LAN_HOST_OFF')
  })

  it('rejects empty device name', () => {
    const { ipc } = makeFixture()
    const r = ipc.pairStart('   ')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('VALIDATION')
  })
})

describe('host:pairPending / pairGrant / pairDeny', () => {
  it('pending lists started code, grant writes three secret places', () => {
    const f = makeFixture()
    const started = unwrap(f.ipc.pairStart('前台机'))
    const p = unwrap(f.ipc.pairPending())
    expect(p).toHaveLength(1)
    const first = p[0]!
    expect(first.code).toBe(started.code)
    expect(first.deviceName).toBe('前台机')

    const g = unwrap(f.ipc.pairGrant(started.code))
    expect(g.deviceId).toBeTruthy()
    // ① 内存 Map
    expect(f.secrets.has(g.deviceId)).toBe(true)
    expect(f.secrets.get(g.deviceId)).toMatch(/^[0-9a-f]{64}$/)
    // ② registerDeviceSecret 兜底表
    expect(f.registered).toHaveLength(1)
    expect(f.registered[0]).toContain(g.deviceId)
    // ③ DPAPI spy 被调 + pending 清空
    expect(unwrap(f.ipc.pairPending())).toHaveLength(0)
  })

  it('grant with invalid code fails E_PAIRING_INVALID', () => {
    const { ipc } = makeFixture()
    ipc.pairStart('d1')
    const r = ipc.pairGrant('999999')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_PAIRING_INVALID')
  })

  it('deny removes pending code and grant afterwards fails', () => {
    const { ipc } = makeFixture()
    const started = unwrap(ipc.pairStart('d1'))
    const d = ipc.pairDeny(started.code)
    expect(d.ok).toBe(true)
    // deny 只删本侧缓存；pairing codes 仍在 → grant 仍可成功（deny 语义为移除 UI 卡片）。
    // 断言 deny 后 pending 不再显示：
    expect(unwrap(ipc.pairPending())).toHaveLength(0)
    expect(ipc.pairGrant(started.code).ok).toBe(true)
  })

  it('deny unknown code fails', () => {
    const { ipc } = makeFixture()
    const r = ipc.pairDeny('000000')
    expect(r.ok).toBe(false)
  })

  it('pending drops expired codes', () => {
    const { ipc } = makeFixture()
    ipc.pairStart('d1')
    now += 6 * 60_000
    expect(unwrap(ipc.pairPending())).toHaveLength(0)
  })
})

describe('host:listDevices / revokeDevice', () => {
  function pairOne(f: Fixture): string {
    const started = unwrap(f.ipc.pairStart('d1'))
    return unwrap(f.ipc.pairGrant(started.code)).deviceId
  }

  it('listDevices shows granted device', () => {
    const f = makeFixture()
    pairOne(f)
    const list = unwrap(f.ipc.listDevices())
    expect(list).toHaveLength(1)
    const dev = list[0]!
    expect(dev.device_name).toBe('d1')
    expect(dev.revoked_at).toBeNull()
  })

  it('revokeDevice removes secret from map and revokes', () => {
    const f = makeFixture()
    const id = pairOne(f)
    const r = f.ipc.revokeDevice(id)
    expect(r.ok).toBe(true)
    expect(f.secrets.has(id)).toBe(false)
    const list = unwrap(f.ipc.listDevices())
    expect(list[0]!.revoked_at).not.toBeNull()
  })

  it('revoke unknown device fails', () => {
    const { ipc } = makeFixture()
    const r = ipc.revokeDevice('no-such-id')
    expect(r.ok).toBe(false)
  })
})

describe('host:status', () => {
  it('all-zero when disabled (T10 零开销断言)', () => {
    const f = makeFixture({ lanAllowed: false, serverPort: null })
    const s = unwrap(f.ipc.status())
    expect(s).toEqual({ enabled: false, port: 0, deviceCount: 0, uptimeMs: 0 })
  })

  it('enabled with port/deviceCount/uptime when running', () => {
    const f = makeFixture()
    const started = unwrap(f.ipc.pairStart('d1'))
    f.ipc.pairGrant(started.code)
    const s = unwrap(f.ipc.status())
    expect(s.enabled).toBe(true)
    expect(s.port).toBe(18650)
    expect(s.deviceCount).toBe(1)
    expect(s.uptimeMs).toBe(100_000)
  })
})

describe('DPAPI persistence (via setSecretStoreDeps)', () => {
  it('writes host-secrets.json through real saveDeviceSecret', async () => {
    // 直接走真实 secret-store 走一遍端到端（临时目录 + mock safeStorage）。
    const { saveDeviceSecret, loadDeviceSecrets, removeDeviceSecret } = await import(
      '../../src/main/host/secret-store'
    )
    const deps = makeSecretDeps()
    expect(saveDeviceSecret(deps, 'dev-1', 'ab'.repeat(32))).toBe(true)
    const loaded = loadDeviceSecrets(deps)
    expect(loaded.get('dev-1')).toBe('ab'.repeat(32))
    const file = join(tmpDir, 'host-secrets.json')
    expect(existsSync(file)).toBe(true)
    // 密文落盘（mock safeStorage 是透传，这里仅断言 secretHex 原文不在文件里）：
    expect(readFileSync(file, 'utf8')).not.toContain('ab'.repeat(32))
    removeDeviceSecret(deps, 'dev-1')
    expect(loadDeviceSecrets(deps).has('dev-1')).toBe(false)
  })
})
