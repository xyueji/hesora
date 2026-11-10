// v1.4：客户端连接状态（renderer 侧 reactive 快照）。
// 数据源：preload 'lan:client-state'（结构化推送）+ lanClientState() 首屏同步快照。
// 与 lan-state.ts（主机侧布尔态）互不混淆：本文件只描述"本机作为客户端"的状态。
import { computed, reactive } from 'vue'

export interface ClientConnSnapshot {
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

export const clientConnState = reactive<ClientConnSnapshot>({
  status: 'idle',
  hostAddress: null,
  deviceName: null,
  deviceId: null,
  hostName: null,
  lastError: null,
  lastErrorCode: null,
  lastConnectedAt: null,
  pairingCode: null,
  pairingExpiresAt: null,
  configured: false,
  suggestedAddress: ''
})

let installed = false

/** App.vue 挂载时调用一次：订阅客户端状态推送并做首屏同步。 */
export function installClientStateWatcher(): void {
  if (installed) return
  installed = true
  try {
    window.api.onLanClientState((s: ClientConnSnapshot) => {
      Object.assign(clientConnState, s)
    })
    const sync = window.api.lanClientState()
    if (sync) Object.assign(clientConnState, sync)
  } catch {
    // preload 未注入（单测/极早期）→ 保持 idle，推送到达后自动纠正。
  }
}

/** 本机是否处于客户端角色（已配置主机，或状态机已离开 idle）。 */
export const clientModeActive = computed<boolean>(
  () => clientConnState.configured || clientConnState.status !== 'idle'
)

/**
 * 客户端写操作禁用：客户端角色下，只有 'connected' 才允许提交写单据。
 * revoked / error / connecting / idle(已配置但已断开) 一律禁写——客户端数据以主机库为准，
 * 断线时回落本机库会造成数据分叉（preload 路由语义同理）。
 * 单机模式（clientModeActive=false）不受影响。
 */
export const clientWriteBlocked = computed<boolean>(
  () => clientModeActive.value && clientConnState.status !== 'connected'
)

/** 禁写提示文案（视图直接展示）。 */
export const clientWriteBlockedReason = computed<string>(() => {
  if (!clientWriteBlocked.value) return ''
  const st = clientConnState.status
  if (st === 'revoked') return '本机已被主机吊销，需重新配对后才能继续开单'
  if (st === 'connecting') return '正在连接主机，写操作暂停；连接恢复后自动可用'
  if (st === 'error') return clientConnState.lastError || '与主机连接异常，写操作暂停'
  return '尚未连接主机，写操作暂停；请在「客户端连接」中连接主机'
})
