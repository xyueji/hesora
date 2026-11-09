// v1.3 Task 6: preload 通道分流挂接（最小改动）。
// 路由规则见 lan-routing.ts。
// ── T8 双审勘误（C2）──
// 客户端接线留待 T9：main 侧尚未注册 'lan:invoke' handler（LanClient 实例化也未接线），
// 若 preload 在 lanConnected 时路由到 'lan:invoke' 会得到 "No handler registered" 错误，
// 把主机半成品路径暴露给渲染层。裁定：v1.3 本任务 preload 恒走 local invoke，
// lanConnected 分支删除；T9 任务书负责注册 'lan:invoke' + LanClient 并恢复 host 路由。
// lanState 仍由 main 经 'lan:state-changed'（布尔 connected）推送，仅供 onLanStateChanged 订阅者使用。
import { contextBridge, ipcRenderer } from 'electron'
import { routeChannel } from './lan-routing'

let lanConnected = false

ipcRenderer.on('lan:state-changed', (_e, connected: unknown) => {
  lanConnected = connected === true
})

const api = {
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    const clean = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload))
    // T9 前 lanConnected 恒为 false 路径（见文件头勘误）：host/blocked 分支不生效
    const target = routeChannel(channel, lanConnected)
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
