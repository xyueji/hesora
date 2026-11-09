// v1.3 Task 6: preload 通道分流——纯函数，可单测。
// 规则（spec §2）：
//  - local 前缀（license:/trial:/update:/host:/window:/print:/csv:/auth:）→ 一律 'local'
//  - backup:/sync: → 客户端 lanConnected 时 'blocked'（客户端不能备份/云同步，E_HOST_ONLY），
//    未连接时 'local'（主机角色本机备份，行为不变）
//  - 其余业务通道 → lanConnected ? 'host' : 'local'（离线兜底全部走本地）
import { LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES, matchesPrefix } from '../shared/channels'

export type RouteTarget = 'local' | 'host' | 'blocked'

export function routeChannel(channel: string, lanConnected: boolean): RouteTarget {
  if (matchesPrefix(channel, LOCAL_CHANNEL_PREFIXES)) return 'local'
  if (matchesPrefix(channel, HOST_ONLY_PREFIXES)) return lanConnected ? 'blocked' : 'local'
  return lanConnected ? 'host' : 'local'
}
