// v1.3 Task 8: 主机端 host:* IPC 逻辑层（渲染层配对确认/设备管理接线）。
// 本模块不 import electron（禁顶层 electron；BrowserWindow/safeStorage 由调用方注入），
// 只组装 pairing 服务 + secret 写回两处（deviceSecrets 内存 Map / DPAPI saveDeviceSecret
// 持久化；T8 双审 A4 删除 server.ts 兜底表死代码后由三处简化为两处）——统一 Result 返回。
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
  /** 吊销设备时踢活跃 WS 连接（index.ts 接线 hub.disconnectDevice；缺省不踢） */
  kickDevice?: (deviceId: string) => void
  /** DPAPI 持久化 deps（saveDeviceSecret/removeDeviceSecret 用）；null=不可用 */
  secretStoreDeps: SecretStoreDeps | null
  saveDeviceSecret: (deps: SecretStoreDeps, deviceId: string, secretHex: string) => void
  removeDeviceSecret: (deps: SecretStoreDeps, deviceId: string) => void
  /** host_lan_enabled === '1' && hasFeature(lan_collaboration)（Tray 门控复用） */
  lanAllowed: () => boolean
  /**
   * v1.4 maxDevices 门控：pairGrant 落库前调用，抛 BizError('E_DEVICE_LIMIT') 表示超上限。
   * index.ts 装配处从 licenseSvc 读 licensePayload → assertMaxDevices；缺省不检查（测试兼容）。
   */
  assertDeviceLimit?: () => void
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

    /** host:pairPending → 待确认列表（过期码顺带清理；含 HTTP /pair/start 桥接的条目） */
    pairPending(): Result<PendingPairing[]> {
      const t = now()
      const out: PendingPairing[] = []
      for (const [code, entry] of startedCodes) {
        if (t >= entry.expiresAt) {
          startedCodes.delete(code)
          continue
        }
        out.push(entry)
      }
      for (const [code, entry] of httpPairRequests) {
        if (t >= entry.expiresAt) {
          httpPairRequests.delete(code)
          continue
        }
        if (!out.some((p) => p.code === code)) out.push(entry)
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
      // v1.4 maxDevices：配对确认（写 host_devices）前检查设备数上限，超限拒绝并回收配对码。
      if (deps.assertDeviceLimit) {
        try {
          deps.assertDeviceLimit()
        } catch (e) {
          pairing.discardPairing(c)
          startedCodes.delete(c)
          httpPairRequests.delete(c)
          const msg = e instanceof Error ? e.message : '设备数已达授权上限'
          return fail('E_DEVICE_LIMIT', msg)
        }
      }
      const { deviceId, secret } = confirmed
      const secretHex = secret.toString('hex')
      // ① 内存 Map（HMAC 查找源） ② DPAPI 持久化（T8 双审 A4：三处写简化为两处）
      deps.deviceSecrets.set(deviceId, secretHex)
      if (secretStoreDeps) {
        deps.saveDeviceSecret(secretStoreDeps, deviceId, secretHex)
      }
      startedCodes.delete(c)
      // HTTP /pair/start 发起的码也要清掉，避免过期前 pairPending 重复列出已允许设备。
      httpPairRequests.delete(c)
      return ok({ deviceId })
    },

    /** host:pairDeny(code)：作废配对码（T8 双审 A1：pairing.codes 一并删除，
     *  deny 后同码 grant 必失败；本侧缓存同步清空）。 */
    pairDeny(code: unknown): Result<{ denied: boolean }> {
      const c = typeof code === 'string' ? code.trim() : ''
      if (!c) return fail('E_PAIRING_INVALID', '配对码无效或已过期')
      const isHttpInitiated = httpPairRequests.delete(c)
      if (!startedCodes.has(c) && !isHttpInitiated) return fail('E_PAIRING_INVALID', '配对码无效或已过期')
      startedCodes.delete(c)
      deps.getPairing()?.discardPairing(c)
      return ok({ denied: true })
    },

    /** host:listDevices → PairedDeviceInfo[] */
    listDevices(): Result<PairedDeviceInfo[]> {
      const pairing = deps.getPairing()
      if (!pairing) return fail('LAN_HOST_OFF', 'LAN 协作主机未启动')
      return ok(pairing.listDevices())
    },

    /** host:revokeDevice(deviceId)：吊销 + secret 两处清除 + 踢活跃 WS 连接（close 4003） */
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
      // T8 双审 A3：吊销后立即断开该设备活跃 WS 连接（HMAC secret 已删，连接不再可用）。
      try {
        deps.kickDevice?.(id)
      } catch {
        // 踢连接失败不影响吊销结果（secret 已删，后续请求会被 401）。
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

/**
 * T9：HTTP /pair/start → host:pairPending 桥。
 * server.ts 的 onPairRequest 回调经 noteHttpPairRequest 落进本模块级 Map；
 * createHostPairIpc 的 pairPending/pairGrant/pairDeny 优先消费它（UI 确认卡片可见 HTTP 发起的配对）。
 */
const httpPairRequests = new Map<string, PendingPairing>()
export function noteHttpPairRequest(entry: { code: string; deviceName: string; expiresAt: number }): void {
  httpPairRequests.set(entry.code, { code: entry.code, deviceName: entry.deviceName, expiresAt: entry.expiresAt })
}

/** Tray 门控纯函数：仅 lanAllowed（license feature + 用户开关）创建托盘。 */
export function shouldCreateTray(lanAllowed: boolean): boolean {
  return lanAllowed
}
