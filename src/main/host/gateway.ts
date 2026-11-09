// v1.3 Task 3: LAN RPC 网关。
// 职责：channel 路由分级（本地/主机专用/未知/幂等/普通）+ 幂等防重放事务包裹。
// 权限校验不在本层：PERMISSION_MAP 守卫属 HTTP 层（auth/pairing 之上），handler 内部
// 的 canFor/can 判定沿用 handlers.ts 现状。
import type { Database } from 'better-sqlite3'
import { fail, ok, BizError, type Result } from '../../shared/result'
import {
  LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES, IDEMPOTENT_CHANNELS, DETERMINISTIC_CODES,
  type SessionContext, type RpcRequest
} from './host-protocol'
import { createIdempotencyStore } from './idempotency'
import type { DB } from '../db'

export interface GatewayDeps {
  getDb: () => DB
  handlers: Map<string, { channel: string; handler: (evt: unknown, payload: unknown, session?: SessionContext) => Promise<unknown> | unknown }>
}

export interface Gateway {
  handleRpc(raw: RpcRequest, session: SessionContext): Promise<Result>
}

function isLocalChannel(channel: string): boolean {
  return LOCAL_CHANNEL_PREFIXES.some((p) => channel.startsWith(p))
}
function isHostOnlyChannel(channel: string): boolean {
  return HOST_ONLY_PREFIXES.some((p) => channel.startsWith(p))
}

export function createGateway(deps: GatewayDeps): Gateway {
  const store = createIdempotencyStore(deps.getDb() as unknown as Database)

  async function handleRpc(raw: RpcRequest, session: SessionContext): Promise<Result> {
    const channel = String(raw?.channel ?? '')
    const payload = raw?.payload
    const requestId = String(raw?.requestId ?? '')

    // 1. 本机专用通道：根本不该进网关，防御性拒绝（不走幂等登记）。
    if (isLocalChannel(channel)) return fail('E_LOCAL_ONLY', '该通道仅限本机调用')
    // 2. 主机专用通道。
    if (isHostOnlyChannel(channel)) return fail('E_HOST_ONLY', '该通道不支持局域网调用')
    // 3. 未知通道。
    const entry = deps.handlers.get(channel)
    if (!entry) return fail('NOT_FOUND', `未知通道：${channel}`)

    const handler = entry.handler

    // 4. 幂等通道：防重记录与业务同一事务（handler 内层 db.transaction 降级为 savepoint）。
    if (IDEMPOTENT_CHANNELS.has(channel)) {
      const db = deps.getDb() as unknown as Database
      const requestHash = store.hashOf(channel, payload)
      try {
        const result = db.transaction((): Result => {
          const verdict = store.begin(requestId, channel, session.deviceId, requestHash)
          if (verdict === 'replay') {
            const cached = store.replay(requestId)
            if (cached) return cached
            // 占位记录（pending，前次非确定性失败未清）→ 视同 fresh 重试
          }
          return runAndCapture(handler, payload, session, requestId)
        })()
        return result
      } catch (e) {
        if (e instanceof BizError && e.code === 'E_REQUEST_ID_CONFLICT') return fail(e.code, e.message)
        // 非确定性失败：事务已回滚（含占位记录），原 ID 可重试
        if (e instanceof BizError) return fail(e.code, e.message)
        return fail('INTERNAL', String((e as Error)?.message ?? e))
      }
    }

    // 5. 普通通道：直接分发。
    try {
      return ok(await handler(null, payload, session))
    } catch (e) {
      if (e instanceof BizError) return fail(e.code, e.message)
      return fail('INTERNAL', String((e as Error)?.message ?? e))
    }
  }

  /** 在事务内执行 handler：成功与确定性失败都 commit 缓存；其余异常向上抛（触发整体回滚）。 */
  function runAndCapture(
    handler: GatewayDeps['handlers'] extends Map<string, infer E> ? E extends { handler: infer H } ? H : never : never,
    payload: unknown,
    session: SessionContext,
    requestId: string
  ): Result {
    try {
      const data = handler(null, payload, session)
      // handler 返回 Promise 的情况：better-sqlite3 事务内不能 await，
      // 异步 handler 的幂等由 service 层同步事务保证——此处先同步取值。
      if (data instanceof Promise) throw new Error('idempotent channel handler must be synchronous')
      const result = ok(data)
      store.commit(requestId, result)
      return result
    } catch (e) {
      if (e instanceof BizError && DETERMINISTIC_CODES.has(e.code)) {
        const result = fail(e.code, e.message)
        store.commit(requestId, result)
        return result
      }
      throw e
    }
  }

  return { handleRpc }
}
