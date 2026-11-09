// v1.3 Task 8: 主机端 host:* IPC 逻辑层（渲染层配对确认/设备管理接线）。
// 本模块不 import electron（禁顶层 electron；BrowserWindow/safeStorage 由调用方注入），
// 只组装 pairing 服务 + secret 写回三处（deviceSecrets 内存 Map / registerDeviceSecret
// server.ts 兜底表 / DPAPI saveDeviceSecret 持久化）——统一 Result 返回。
import { networkInterfaces } from 'node:os'
import { ok, fail, type Result } from '../../shared/result'
import type { PairingService, PairedDeviceInfo } from '../host/pairing'
import type { SecretStoreDeps } from '../host/secret-store'

/** host:status 的返回（T10 零开销测试断言：enabled=false 时全零值）。 */
export interface HostStatus {
  enabled: boolean
  port: number
  deviceCount: number
  uptimeMs: number
}

/** /pair/start 后的待确认条目（host:pairPending 返回）。 */
export interface PendingPairing {
  code: string
  deviceName: string
  expiresAt: number
}

export interface HostPairIpcDeps {
  /** 主机 IIFE 内赋值的 pairing 实例；null = 主机未启动（LAN_HOST_OFF） */
  getPairing: () => PairingService | null
  /** hostServer 存活状态与端口（host:status 用） */
  getServerInfo: () => { port: number } | null
  /** 内存 deviceSecrets Map（HMAC 查找源） */
  deviceSecrets: Map<string, string>
  /** server.ts registerDeviceSecret（内存表兜底） */
  registerDeviceSecret: (deviceId: string, secretHex: string) => void
  /** DPAPI 持久化 deps（saveDeviceSecret/removeDeviceSecret 用）；null=不可用 */
  secretStoreDeps: SecretStoreDeps | null
  saveDeviceSecret: (deps: SecretStoreDeps, deviceId: string, secretHex: string) => void
  removeDeviceSecret: (deps: SecretStoreDeps, deviceId: string) => void
  /** host_lan_enabled === '1' && hasFeature(lan_collaboration)（Tray 门控复用） */
  lanAllowed: () => boolean
  now?: () => number
  /** 主机进程启动时刻（uptime 计算） */
  startedAt?: number
}

export interface HostPairIpc {
  /** 供测试断言内部镜像（生产不使用）。 */
  readonly _startedCodes: Map<string, PendingPairing>
  pairStart(deviceName: unknown): Result<{ code: string; expiresAt: number; ip: string | null; qrPayload: string }>
  pairPending(): Result<PendingPairing[]>
  pairGrant(code: unknown): Result<{ deviceId: string }>
  pairDeny(code: unknown): Result<{ denied: boolean }>
  listDevices(): Result<PairedDeviceInfo[]>
  revokeDevice(deviceId: unknown): Result<{ deviceId: string }>
  status(): Result<HostStatus>
  /** safeStorage 异步 import 后补齐 DPAPI deps（main 侧接线用）。 */
  setSecretStoreDeps(d: SecretStoreDeps): void
}

export function createHostPairIpc(deps: HostPairIpcDeps): HostPairIpc {
  const now = deps.now ?? Date.now
  const startedAt = deps.startedAt ?? now()
  // DPAPI deps 异步补齐槽位（main 侧 safeStorage 动态 import 后 setSecretStoreDeps）。
  let secretStoreDeps = deps.secretStoreDeps

  // pairStart 产生的待确认码缓存（pairPending 轮询 / pairGrant / pairDeny 共用）。
  // startPairing 返回 {code,expiresAt} 但 pairing 内部 codes Map 不可读，故本侧镜像。
  const startedCodes = new Map<string, PendingPairing>()

  /** os.networkInterfaces() 首个非内部 IPv4（二维码 payload 用）。 */
  function localIpv4(): string | null {
    const ifaces = networkInterfaces()
    for (const list of Object.values(ifaces)) {
      for (const it of list ?? []) {
        if (it.family === 'IPv4' && !it.internal) return it.address
      }
    }
    return null
  }

  return {
    /** 供测试注入时钟后清理（生产不需要）。 */
    _startedCodes: startedCodes,

    /** host:pairStart(deviceName) → {code,expiresAt,ip,qrPayload} */
    pairStart(deviceName: unknown): Result<{ code: string; expiresAt: number; ip: string | null; qrPayload: string }> {
      const pairing = deps.getPairing()
      if (!pairing) return fail('LAN_HOST_OFF', 'LAN 协作主机未启动（未授权或未在设置中开启）')
      const name = typeof deviceName === 'string' ? deviceName.trim() : ''
      if (!name) return fail('VALIDATION', '设备名不能为空')
      const started = pairing.startPairing(name)
      startedCodes.set(started.code, { code: started.code, deviceName: name, expiresAt: started.expiresAt })
      const ip = localIpv4()
      const port = deps.getServerInfo()?.port ?? 18650
      const qrPayload = `hesora-pair://${ip ?? '0.0.0.0'}:${port}/${started.code}`
      return ok({ code: started.code, expiresAt: started.expiresAt, ip, qrPayload })
    },

    /** host:pairPending → 待确认列表（过期码顺带清理） */
    pairPending(): Result<PendingPairing[]> {
      const pairing = deps.getPairing()
      if (!pairing) return ok([])
      const t = now()
      const out: PendingPairing[] = []
      for (const [code, entry] of startedCodes) {
        if (t >= entry.expiresAt) {
          startedCodes.delete(code)
          continue
        }
        out.push(entry)
      }
      return ok(out)
    },

    /** host:pairGrant(code)：confirmPairing 成功 → 三处写 secret → {deviceId} */
    pairGrant(code: unknown): Result<{ deviceId: string }> {
      const pairing = deps.getPairing()
      if (!pairing) return fail('LAN_HOST_OFF', 'LAN 协作主机未启动')
      const c = typeof code === 'string' ? code.trim() : ''
      if (!c) return fail('VALIDATION', '配对码不能为空')
      const confirmed = pairing.confirmPairing(c)
      if (!confirmed) return fail('E_PAIRING_INVALID', '配对码无效、已过期或已被处理')
      const { deviceId, secret } = confirmed
      const secretHex = secret.toString('hex')
      // ① 内存 Map（HMAC 查找源）② server.ts 兜底表 ③ DPAPI 持久化（三处都写）
      deps.deviceSecrets.set(deviceId, secretHex)
      deps.registerDeviceSecret(deviceId, secretHex)
      if (secretStoreDeps) {
        deps.saveDeviceSecret(secretStoreDeps, deviceId, secretHex)
      }
      startedCodes.delete(c)
      return ok({ deviceId })
    },

    /** host:pairDeny(code)：确认码作废（pairing 的 codes 已 confirmed=false，本侧直接删缓存；
     *  客户端轮询拿不到会话即失败，无需 pairing 侧配合）。 */
    pairDeny(code: unknown): Result<{ denied: boolean }> {
      const c = typeof code === 'string' ? code.trim() : ''
      if (!c || !startedCodes.has(c)) return fail('E_PAIRING_INVALID', '配对码无效或已过期')
      startedCodes.delete(c)
      return ok({ denied: true })
    },

    /** host:listDevices → PairedDeviceInfo[] */
    listDevices(): Result<PairedDeviceInfo[]> {
      const pairing = deps.getPairing()
      if (!pairing) return fail('LAN_HOST_OFF', 'LAN 协作主机未启动')
      return ok(pairing.listDevices())
    },

    /** host:revokeDevice(deviceId)：吊销 + 三处 secret 一并清除 */
    revokeDevice(deviceId: unknown): Result<{ deviceId: string }> {
      const pairing = deps.getPairing()
      if (!pairing) return fail('LAN_HOST_OFF', 'LAN 协作主机未启动')
      const id = typeof deviceId === 'string' ? deviceId : ''
      if (!id) return fail('VALIDATION', '设备 id 不能为空')
      const r = pairing.revokeDevice(id)
      if (!r.ok) return fail(r.code, r.msg)
      deps.deviceSecrets.delete(id)
      if (secretStoreDeps) {
        deps.removeDeviceSecret(secretStoreDeps, id)
      }
      return ok({ deviceId: id })
    },

    /** host:status → {enabled,port,deviceCount,uptimeMs}（enabled=false 全零值，T10 断言） */
    status(): Result<HostStatus> {
      const server = deps.getServerInfo()
      const enabled = deps.lanAllowed() && server !== null && deps.getPairing() !== null
      if (!enabled) return ok({ enabled: false, port: 0, deviceCount: 0, uptimeMs: 0 })
      const pairing = deps.getPairing() as PairingService
      return ok({
        enabled: true,
        port: server?.port ?? 0,
        deviceCount: pairing.listDevices().filter((d) => d.revoked_at === null).length,
        uptimeMs: now() - startedAt
      })
    },

    setSecretStoreDeps(d: SecretStoreDeps): void {
      secretStoreDeps = d
    }
  }
}

/** Tray 门控纯函数：仅 lanAllowed（license feature + 用户开关）创建托盘。 */
export function shouldCreateTray(lanAllowed: boolean): boolean {
  return lanAllowed
}
