// v1.3 Task 8: 幂等请求 pending 登记（lan-client 侧）。
// spec §4.3：幂等通道（IDEMPOTENT_CHANNELS）发请求前登记 {requestId,channel,payload}；
// 响应确定性失败（DETERMINISTIC_CODES，如 NOT_ENOUGH/VALIDATION——重试也必失败）→ 删除；
// 网络/未知错误（E_HOST_UNREACHABLE 等）→ 保留，重试时用**原 requestId** 重发
// （幂等键不变 → 主机侧 idempotency 表防重复过账；nonce 换新不影响，防重放窗口按请求计）。
// 持久化裁定（记录于 spec 勘误节）：v1.3 采用**内存 Map + 可选 flush 钩子**——
// pendingFile 依赖注入；lan-client 在 main 进程侧可以直接落盘（它本就 import node:fs 能力层
// 无关 electron），但跨重启恢复语义（会话 token 8h 滑动过期）使跨进程恢复价值有限，
// 故默认内存 + onFlush 回调暴露给接线层（index.ts 想接 app 'before-quit' flush 时可用）。
import { DETERMINISTIC_CODES, IDEMPOTENT_CHANNELS } from './host-protocol'
import type { Result } from '../../shared/result'

export interface PendingEntry {
  requestId: string
  channel: string
  payload: unknown
}

export interface PendingRegistryDeps {
  /** 可选持久化（v1.3 默认内存；接线层可传 fs 实现做退出 flush） */
  persist?: {
    load(): PendingEntry[]
    save(entries: PendingEntry[]): void
  }
}

export interface PendingRegistry {
  /** 幂等通道发请求前登记；返回 false 表示该通道不需要登记。 */
  track(entry: PendingEntry): boolean
  /** 响应到达后的收敛：确定性失败/成功 → 删除；网络/未知错误 → 保留。 */
  settle(entry: PendingEntry, result: Result): void
  /** 网络失败后原样取出待重试（不删除；重试成功后经 settle 删除）。 */
  all(): PendingEntry[]
  size(): number
  /** 接线层退出 flush 用（可选持久化时）。 */
  flush(): void
}

function isIdempotent(channel: string): boolean {
  return IDEMPOTENT_CHANNELS.has(channel)
}

function isDeterministicFailure(result: Result): boolean {
  return !result.ok && (DETERMINISTIC_CODES as ReadonlySet<string>).has(result.code)
}

/** 网络/未知失败：保留 pending 供重试。判定：!ok 且 code 不在 DETERMINISTIC_CODES。 */
export function isTransientFailure(result: Result): boolean {
  return !result.ok && !(DETERMINISTIC_CODES as ReadonlySet<string>).has(result.code)
}

/** T8 双审勘误 Minor：pending 上限，超出驱逐最旧（Map 保序 = 插入序）。 */
const MAX_PENDING = 200

export function createPendingRegistry(deps?: PendingRegistryDeps): PendingRegistry {
  const map = new Map<string, PendingEntry>() // key=requestId
  if (deps?.persist) {
    // T8 双审勘误 I4：load/save 降级——持久化损坏不阻断业务，记 console 后按空恢复。
    try {
      for (const e of deps.persist.load()) map.set(e.requestId, e)
    } catch (e) {
      console.error('[pending-registry] persist.load failed, starting empty:', e)
    }
  }

  function persist(): void {
    if (!deps?.persist) return
    try {
      deps.persist.save([...map.values()])
    } catch (e) {
      console.error('[pending-registry] persist.save failed (kept in memory):', e)
    }
  }

  function evictOldest(): void {
    while (map.size >= MAX_PENDING) {
      const oldest = map.keys().next()
      if (oldest.done) break
      map.delete(oldest.value)
    }
  }

  return {
    track(entry) {
      if (!isIdempotent(entry.channel)) return false
      evictOldest()
      map.set(entry.requestId, entry)
      persist()
      return true
    },
    settle(entry, result) {
      // 只有我们登记过的才收敛；成功与确定性失败都删除，瞬态失败保留
      if (!map.has(entry.requestId)) return
      if (result.ok || isDeterministicFailure(result)) {
        map.delete(entry.requestId)
        persist()
      }
    },
    all: () => [...map.values()],
    size: () => map.size,
    flush: () => persist()
  }
}
