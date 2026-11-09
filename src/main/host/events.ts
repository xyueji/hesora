// v1.3 Task 6: 主机侧 WS 事件广播 hub（spec §6）。
// 设计约定：
//  - attachWsHub(wssLike) 面向两种 server 形状做适配：① WebSocketServer 实例（有 .on('connection')）；
//    ② 注册回调形状 onConnection(cb)。T5 server.ts 最终接线时二选一调用，另一形状不生效。
//  - 推送概要 only（单号/数量/时间），绝不推业务数据全文（spec 红线）：broadcast 只保留
//    { event, at, summary }，summary 之外的字段一律剥离，即使调用方误传全文也不会外泄。
//  - 权限过滤映射表定义在本文件内（EVENT_PERMISSION_MAP / EVENT_PERMISSION_ALTS），权限 key 来自
//    src/shared/permissions.ts，与 src/main/permissions-map.ts（channel→PermissionKey）相邻维护：
//    permissions-map 管"调通道要什么权限"，这里管"收事件要什么权限"，两者按事件粒度对应。
//  - ping/pong：每 25s server 主动 ping（T5 server 若已有 ws 层心跳，可关闭本 hub 心跳：
//    opts.pingIntervalMs=0）；60s 无 pong 由 conn.close() 关闭。
import type { PermissionKey } from '../../shared/permissions'

export type HostEventName = 'doc.changed' | 'inventory.changed' | 'master.changed'

export interface HostEvent {
  event: HostEventName
  at: string
  summary?: Record<string, unknown>
}

export interface SessionContext {
  deviceId: string
  userId: number
}

/** 最小 WS 连接接口：Node ws 的 WebSocket 与测试假对象都满足（EventEmitter + send/close）。 */
export interface WsLike {
  on(event: string, cb: (...args: unknown[]) => void): unknown
  send(data: string): unknown
  close(): unknown
}

/** wss 适配接口：① WebSocketServer（on('connection')）；② onConnection(cb) 回调形状。 */
export interface WsHubLike {
  on?(event: 'connection', cb: (conn: WsLike) => void): unknown
  onConnection?(cb: (conn: WsLike) => void): unknown
}

type CanFor = (userId: number, key: PermissionKey) => boolean

/** 事件→必需权限（单一权限）。 */
export const EVENT_PERMISSION_MAP: Record<Exclude<HostEventName, 'master.changed'>, PermissionKey> = {
  'doc.changed': 'doc.viewAll',
  'inventory.changed': 'inventory.report'
}

/** master.changed：按 summary.entity 需要对应主档 view；简化为任一主档 view 权限即可收。 */
export const MASTER_EVENT_ALTS: readonly PermissionKey[] = ['customer.view', 'product.view', 'supplier.view']

export interface EventHub {
  registerConnection(conn: WsLike, session: SessionContext, canFor: CanFor): void
  broadcast(event: HostEvent): void
  connectionCount(): number
  /** T5 接线：wssLike 为 WebSocketServer（.on('connection')）或 { onConnection(cb) }；
   *  sessionOf(conn) 返回 null 时直接关闭该连接（未认证连接不得订阅）。 */
  attachWsHub(wssLike: WsHubLike, sessionOf: (conn: WsLike) => { session: SessionContext; canFor: CanFor } | null): void
}

export interface EventHubOpts {
  log?: (msg: string) => void
  pingIntervalMs?: number
  pongTimeoutMs?: number
  now?: () => number
}

const DEFAULT_PING_MS = 25_000
const DEFAULT_PONG_TIMEOUT_MS = 60_000

interface Registration {
  conn: WsLike
  session: SessionContext
  canFor: CanFor
  events: Set<HostEventName>
  lastPongAt: number
}

function eventAllowed(name: HostEventName, canFor: CanFor, userId: number): boolean {
  if (name === 'master.changed') {
    return MASTER_EVENT_ALTS.some((k) => canFor(userId, k))
  }
  return canFor(userId, EVENT_PERMISSION_MAP[name as Exclude<HostEventName, 'master.changed'>])
}

export function createEventHub(opts?: EventHubOpts): EventHub {
  const log = opts?.log ?? (() => {})
  const pingIntervalMs = opts?.pingIntervalMs ?? DEFAULT_PING_MS
  const pongTimeoutMs = opts?.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS
  const now = opts?.now ?? Date.now
  const registry = new Map<WsLike, Registration>()
  let timer: ReturnType<typeof setInterval> | null = null

  function sweep(nowMs: number): void {
    for (const [conn, reg] of registry) {
      if (nowMs - reg.lastPongAt > pongTimeoutMs) {
        log(`ws stale: device=${reg.session.deviceId}`)
        try {
          conn.close()
        } catch {
          /* already dead */
        }
        registry.delete(conn)
      } else {
        try {
          conn.send(JSON.stringify({ type: 'ping' }))
        } catch {
          registry.delete(conn)
        }
      }
    }
  }

  function ensureTimer(): void {
    if (pingIntervalMs <= 0 || timer) return
    timer = setInterval(() => sweep(now()), pingIntervalMs)
    // Node 环境下不让 interval 挂住进程退出
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  function detach(conn: WsLike): void {
    registry.delete(conn)
  }

  function registerConnection(conn: WsLike, session: SessionContext, canFor: CanFor): void {
    const reg: Registration = { conn, session, canFor, events: new Set(), lastPongAt: now() }
    registry.set(conn, reg)
    ensureTimer()

    conn.on('message', (raw: unknown) => {
      let msg: { type?: string; events?: unknown }
      try {
        msg = JSON.parse(String(raw)) as { type?: string; events?: unknown }
      } catch {
        return
      }
      if (msg.type === 'pong') {
        reg.lastPongAt = now()
        return
      }
      if (msg.type === 'subscribe' && Array.isArray(msg.events)) {
        const valid: HostEventName[] = ['doc.changed', 'inventory.changed', 'master.changed']
        const events = (msg.events as unknown[]).filter((e): e is HostEventName => valid.includes(e as HostEventName))
        reg.events = new Set(events)
        try {
          conn.send(JSON.stringify({ type: 'subscribed', events }))
        } catch {
          detach(conn)
        }
      }
      // 其他消息类型忽略
    })

    conn.on('close', () => detach(conn))
    conn.on('error', () => detach(conn))
  }

  function broadcast(event: HostEvent): void {
    // 红线：只保留 { event, at, summary }——调用方误传明细全文也会被剥离
    const wire = JSON.stringify({
      type: 'event',
      event: event.event,
      at: event.at,
      summary: event.summary
    })
    for (const [conn, reg] of registry) {
      if (!reg.events.has(event.event)) continue
      if (!eventAllowed(event.event, reg.canFor, reg.session.userId)) continue
      try {
        conn.send(wire)
      } catch {
        detach(conn)
      }
    }
  }

  function attachWsHub(wssLike: WsHubLike, sessionOf: (conn: WsLike) => { session: SessionContext; canFor: CanFor } | null): void {
    const onConn = (conn: WsLike): void => {
      const meta = sessionOf(conn)
      if (!meta) {
        try {
          conn.close()
        } catch {
          /* ignore */
        }
        return
      }
      registerConnection(conn, meta.session, meta.canFor)
    }
    if (typeof wssLike.on === 'function') wssLike.on('connection', onConn)
    else if (typeof wssLike.onConnection === 'function') wssLike.onConnection(onConn)
    else log('attachWsHub: no known connection hook shape')
  }

  return {
    registerConnection,
    broadcast,
    connectionCount: () => registry.size,
    attachWsHub
  }
}
