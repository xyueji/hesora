// v1.3 Task 6: preload 通道分流挂接（最小改动）。
// 路由规则见 lan-routing.ts；'host' 通道经 ipcRenderer.invoke('lan:invoke', …) 转发，
// main 侧由 lan-transport/lan-client（T5/T8 接线实例）发往主机。
// lanState 由 main 经 'lan:state-changed' IPC 事件推送，preload 维护镜像供 routeChannel 使用。
import { contextBridge, ipcRenderer } from 'electron'
import { routeChannel } from './lan-routing'

const lanState = { connected: false }

ipcRenderer.on('lan:state-changed', (_e, connected: unknown) => {
  lanState.connected = connected === true
})

const api = {
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    const clean = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
    const target = routeChannel(channel, lanState.connected)
    if (target === 'host') {
      return ipcRenderer.invoke('lan:invoke', { channel, payload: clean })
    }
    if (target === 'blocked') {
      return { ok: false, code: 'E_HOST_ONLY', msg: '该操作只能在主机上执行（备份/云同步不开放给局域网客户端）', data: null }
    }
    return ipcRenderer.invoke(channel, clean)
  },
  /** 供 renderer 订阅 LAN 连接状态变化（T8 视图用） */
  onLanStateChanged: (cb: (connected: boolean) => void): void => {
    ipcRenderer.on('lan:state-changed', (_e, connected: unknown) => cb(connected === true))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
