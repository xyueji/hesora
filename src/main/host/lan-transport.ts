// v1.3 Task 6: main 侧 'lan:invoke' 接线薄壳——preload 分流过来的 host 通道在这里真正发往主机。
// TODO(T5/T8)：server.ts 侧创建 LanClient 实例后，用 createLanIpcHandlers(client) 注册 ipcMain；
// 本文件只导出工厂，避免在模块加载期触碰 electron（可单测）。
import type { LanClient } from './lan-client'
import type { Result } from '../../shared/result'

export function createLanIpcHandlers(client: LanClient): {
  invoke: (channel: string, payload: unknown) => Promise<Result>
} {
  return {
    invoke: (channel, payload) => client.invoke(channel, payload)
  }
}
