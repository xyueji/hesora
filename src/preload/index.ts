// v1.4 客户端接线：preload 通道分流 + 客户端状态订阅。
// 路由规则见 lan-routing.ts。
// ── 两套状态，互不混淆 ──
//  ① 主机侧：'lan:state-changed'（布尔）= 本机作为**主机**时是否有远程客户端连着
//     → ConnectionStatusBar 的"主机侧状态"。
//  ② 客户端侧：'lan:client-state'（结构化）= 本机作为**客户端**连接主机的状态
//     → ConnectionStatusBar 的"客户端侧状态" + 决定业务通道走主机还是本机。
// ── v1.4 路由语义修正 ──
//  业务通道的路由依据从"当前是否连着主机"改为"本机是否处于**客户端角色**"（已配置主机）。
//  原因：客户端角色的数据以主机库为准，若断线时回落本机（本地 SQLite），会产生
//  数据分叉/静默写脏本地库。故客户端角色下一律走主机（断线时请求失败并回错误码），
//  读写都走主机，读失败按错误码区分提示。
import { contextBridge, ipcRenderer } from 'electron'
import { routeChannel } from './lan-routing'

export interface LanClientStateSnapshot {
  status: 'idle' | 'pairing' | 'connecting' | 'connected' | 'revoked' | 'error'
  hostAddress: string | null
  deviceName: string | null
  deviceId: string | null
  hostName: string | null
  lastError: string | null
  lastErrorCode: string | null
  lastConnectedAt: string | null
  pairingCode: string | null
  pairingExpiresAt: number | null
  configured: boolean
  suggestedAddress: string
}

/** 主机侧连接状态（本机作为主机；远程客户端在线与否）。 */
let hostConnected = false
/** 客户端侧状态（本机作为客户端）。 */
let clientState: LanClientStateSnapshot | null = null
/** 本机是否处于客户端角色（已配置主机）→ 业务通道一律走主机。 */
let clientMode = false

function applyClientState(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const st = raw as Partial<LanClientStateSnapshot>
  clientState = {
    status: st.status ?? 'idle',
    hostAddress: st.hostAddress ?? null,
    deviceName: st.deviceName ?? null,
    deviceId: st.deviceId ?? null,
    hostName: st.hostName ?? null,
    lastError: st.lastError ?? null,
    lastErrorCode: st.lastErrorCode ?? null,
    lastConnectedAt: st.lastConnectedAt ?? null,
    pairingCode: st.pairingCode ?? null,
    pairingExpiresAt: st.pairingExpiresAt ?? null,
    configured: st.configured === true,
    suggestedAddress: st.suggestedAddress ?? ''
  }
  clientMode = clientState.configured || clientState.status !== 'idle'
}

ipcRenderer.on('lan:state-changed', (_e, connected: unknown) => {
  hostConnected = connected === true
})

ipcRenderer.on('lan:client-state', (_e, state: unknown) => {
  applyClientState(state)
})

// 首屏竞态消除：preload 阶段同步拉一次客户端状态（main 在 createWindow 之前注册 handler），
// 否则渲染层首个业务请求可能因路由状态未达而降级到本机。
try {
  applyClientState(ipcRenderer.sendSync('lan:clientStatusSync'))
} catch {
  // main 未注册同步 handler（单测/极早期）→ 保持 idle，后续推送会纠正。
}

const api = {
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    const clean = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
    const target = routeChannel(channel, clientMode)
    if (target === 'blocked') {
      return { ok: false, code: 'E_HOST_ONLY', msg: '该操作只能在主机上执行（备份/云同步不开放给局域网客户端）', data: null }
    }
    if (target === 'host') {
      // 客户端角色：业务请求转发给主机（main 侧 'lan:invoke' → LanClient.invoke）。
      return ipcRenderer.invoke('lan:invoke', { channel, payload: clean })
    }
    return ipcRenderer.invoke(channel, clean)
  },
  /** 供 renderer 订阅主机侧 LAN 状态变化（T8 视图用） */
  onLanStateChanged: (cb: (connected: boolean) => void): void => {
    ipcRenderer.on('lan:state-changed', (_e, connected: unknown) => cb(connected === true))
  },
  /** v1.4：订阅客户端侧状态（结构化）。 */
  onLanClientState: (cb: (state: LanClientStateSnapshot) => void): void => {
    ipcRenderer.on('lan:client-state', (_e, state: unknown) => {
      applyClientState(state)
      cb(clientState as LanClientStateSnapshot)
    })
  },
  /** v1.4：读取客户端侧状态快照（同步，供非响应式场景使用）。 */
  lanClientState: (): LanClientStateSnapshot | null => clientState,
  /** v1.4：主机侧连接状态快照（同步）。 */
  lanHostConnected: (): boolean => hostConnected
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
