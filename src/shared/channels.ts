// v1.3 Task 6: 通道分类常量——从 src/main/host/host-protocol.ts 下沉（preload 不能 import src/main）。
// host-protocol.ts 已改为从这里 re-export，值保持逐字节一致；两边都必须 import 本文件，严禁再复制常量。

/** 本机专用前缀：与 Electron 生命周期/本机外设/登录态绑定，不得进 LAN（host-protocol.ts 同名常量的唯一来源）。 */
export const LOCAL_CHANNEL_PREFIXES = [
  'license:',
  'trial:',
  'update:',
  'host:',
  'window:',
  'print:',
  'csv:',
  'auth:',
  // v1.4：客户端接线（本机作为 LAN 客户端）自身的状态/配对通道属本机专用，
  // 远程客户端不得调用（主机侧网关按 LOCAL 前缀回 E_LOCAL_ONLY）。
  'lan:'
] as const

/** 主机专用前缀：LAN 客户端调用返回 E_HOST_ONLY（备份/云同步涉及主机本机文件系统与云盘凭据）。 */
export const HOST_ONLY_PREFIXES = ['backup:', 'sync:'] as const

export function matchesPrefix(channel: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => channel.startsWith(p))
}
