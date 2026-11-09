// v1.3 Task 3: 幂等防重放存储（spec §4.4，migration 080 command_results）。
// requestHash = sha256(channel + '\n' + JSON.stringify(payload))。
// JSON.stringify 的 key 顺序即客户端序列化约定：LAN 客户端必须按
// 「请求对象字面量的声明顺序（或文档约定的固定顺序）」序列化 payload，
// 保证同语义请求得到同 hash；文档见 docs/superpowers/specs §4.4。
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { BizError, type Result } from '../../shared/result'

export type BeginVerdict = 'fresh' | 'replay' | 'conflict'

export interface IdempotencyStore {
  /** 计算 requestHash（导出供测试与客户端文档对账） */
  hashOf(channel: string, payload: unknown): string
  /**
   * 登记请求。须在业务事务内调用（gateway 用 db.transaction 包裹，handler 内层
   * 事务自动降级为 savepoint，保证防重记录与业务同原子性）。
   * - fresh：无同 ID 记录，已插入占位（result_json 暂存 pending）；
   * - replay：同 ID 同 hash，业务不得再执行；
   * - conflict：同 ID 异 hash（或异 channel）→ BizError('E_REQUEST_ID_CONFLICT')。
   */
  begin(requestId: string, channel: string, deviceId: string, requestHash: string): BeginVerdict
  /** 写入最终 Result（成功与确定性失败都存）。 */
  commit(requestId: string, result: Result): void
  /**
   * 非确定性失败（INTERNAL/崩溃）时清理占位记录，使原 ID 可重试。
   * 与 begin 不同事务时才需要；同事务内抛异常即整体回滚，此函数供两段式路径使用。
   */
  abort(requestId: string): void
  /** 读取缓存结果；无记录返回 null。 */
  replay(requestId: string): Result | null
  /** 清理：90 天过期 + 每设备保留最近 1000 条。nowMs 可注入用于测试。 */
  cleanup(nowMs?: number): void
}

const RETENTION_DAYS = 90
const PER_DEVICE_CAP = 1000
const PENDING = '__pending__'

export function createIdempotencyStore(db: Database): IdempotencyStore {
  const insert = db.prepare(
    `INSERT INTO command_results (request_id, channel, device_id, request_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const byId = db.prepare(
    'SELECT request_id, channel, request_hash, result_json FROM command_results WHERE request_id = ?'
  )
  const updateResult = db.prepare('UPDATE command_results SET result_json = ? WHERE request_id = ?')
  const deleteById = db.prepare('DELETE FROM command_results WHERE request_id = ?')
  const deleteOlderThan = db.prepare('DELETE FROM command_results WHERE created_at < ?')
  const deviceIds = db.prepare('SELECT DISTINCT device_id FROM command_results')
  const deleteOldestKeep = db.prepare(
    `DELETE FROM command_results WHERE device_id = ? AND request_id NOT IN (
       SELECT request_id FROM command_results WHERE device_id = ? ORDER BY created_at DESC, request_id DESC LIMIT ?
     )`
  )

  function hashOf(channel: string, payload: unknown): string {
    return createHash('sha256').update(channel + '\n' + JSON.stringify(payload)).digest('hex')
  }

  function begin(requestId: string, channel: string, deviceId: string, requestHash: string): BeginVerdict {
    const existing = byId.get(requestId) as
      | { request_id: string; channel: string; request_hash: string; result_json: string }
      | undefined
    if (existing) {
      if (existing.channel !== channel || existing.request_hash !== requestHash) {
        throw new BizError('E_REQUEST_ID_CONFLICT', `请求 ID ${requestId} 已被其他内容使用，请更换 requestId`)
      }
      return 'replay'
    }
    insert.run(requestId, channel, deviceId, requestHash, PENDING, new Date().toISOString())
    return 'fresh'
  }

  function commit(requestId: string, result: Result): void {
    updateResult.run(JSON.stringify(result), requestId)
  }

  function abort(requestId: string): void {
    deleteById.run(requestId)
  }

  function replay(requestId: string): Result | null {
    const row = byId.get(requestId) as { result_json: string } | undefined
    if (!row || row.result_json === PENDING) return null
    try {
      return JSON.parse(row.result_json) as Result
    } catch {
      return null
    }
  }

  function cleanup(nowMs: number = Date.now()): void {
    const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 3600 * 1000).toISOString()
    deleteOlderThan.run(cutoff)
    for (const { device_id } of deviceIds.all() as { device_id: string }[]) {
      deleteOldestKeep.run(device_id, device_id, PER_DEVICE_CAP)
    }
  }

  return { hashOf, begin, commit, abort, replay, cleanup }
}
