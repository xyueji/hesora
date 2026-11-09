// v1.3 Task 6: renderer 侧 LAN 连接状态（纯 reactive，不含视图——T8 视图消费）。
import { reactive } from 'vue'

export interface LanState {
  connected: boolean
  /** 一次 invoke 因 'blocked'（客户端不能 backup/sync）被拒的最后时间，供 UI 提示 */
  lastBlockedAt: string | null
}

export const lanState = reactive<LanState>({ connected: false, lastBlockedAt: null })

export function setLanConnected(connected: boolean): void {
  lanState.connected = connected
}

export function markLanBlocked(): void {
  lanState.lastBlockedAt = new Date().toISOString()
}
