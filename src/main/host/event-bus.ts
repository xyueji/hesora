// v1.3 Task 8: 主机事件总线（模块级 emitter，进程内单例）。
// 用途：业务层（handlers.ts 写通道成功后）emitHostEvent(...) 发布主机事件，
// index.ts 的 LAN 装配区 setEventSink(hub.broadcast) 消费。业务层不 import electron、
// 不感知 hub 存在——未接线（单机模式/测试未设 sink）时事件静默丢弃（默认 no-op）。
// 红线由 events.ts broadcast 兜底：只外发 { event, at, summary }。
import type { HostEvent } from './events'

type HostEventSink = (event: HostEvent) => void

let sink: HostEventSink | null = null

/** index.ts LAN 装配区调用：接上 hub.broadcast。传 null 恢复静默。 */
export function setHostEventSink(fn: HostEventSink | null): void {
  sink = fn
}

/** 业务侧发射口：绝不向业务流程抛错（sink 异常吞掉只记 console）。 */
export function emitHostEvent(event: HostEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch (e) {
    console.error('[lan-events] event sink failed:', e)
  }
}
