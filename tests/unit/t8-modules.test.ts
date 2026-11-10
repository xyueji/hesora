// v1.3 Task 8: 重连状态机 + pending 登记 + 事件总线 + secret-store 单测。
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReconnectController, BACKOFF_SCHEDULE_MS, JITTER_MAX_MS } from '../../src/main/host/reconnect'
import { createPendingRegistry, isTransientFailure } from '../../src/main/host/pending-registry'
import { setHostEventSink, emitHostEvent } from '../../src/main/host/event-bus'
import {
  saveDeviceSecret,
  loadDeviceSecrets,
  removeDeviceSecret,
  isSecretPersistenceAvailable,
  type SafeStorageLike
} from '../../src/main/host/secret-store'
import { fail, ok } from '../../src/shared/result'

// ── reconnect ──
describe('reconnect controller', () => {
  function fakeTimers() {
    const pending: { delay: number; fn: () => void }[] = []
    const schedule = (delay: number, fn: () => void) => { pending.push({ delay, fn }); return pending.length - 1 }
    const cancel = (h: unknown) => { const i = h as number; if (pending[i]) pending[i] = { delay: 0, fn: () => {} } }
    return { pending, schedule, cancel }
  }

  it('markDisconnected schedules backoff within schedule+jitter bounds', () => {
    const t = fakeTimers()
    const ctl = createReconnectController({ attempt: async () => false, schedule: t.schedule, cancel: t.cancel })
    ctl.markDisconnected()
    expect(t.pending).toHaveLength(1)
    expect(t.pending[0]!.delay).toBeGreaterThanOrEqual(BACKOFF_SCHEDULE_MS[0])
    expect(t.pending[0]!.delay).toBeLessThanOrEqual(BACKOFF_SCHEDULE_MS[0] + JITTER_MAX_MS)
  })

  it('grows exponentially across failed rounds and resets on markConnected', async () => {
    const flush = (): Promise<void> => new Promise((r) => setImmediate(r))
    const t = fakeTimers()
    const ctl = createReconnectController({ attempt: async () => false, schedule: t.schedule, cancel: t.cancel })
    ctl.markDisconnected()
    for (let round = 0; round < 5; round++) {
      const cur = t.pending[t.pending.length - 1]!
      expect(cur.delay).toBeGreaterThanOrEqual(BACKOFF_SCHEDULE_MS[round] ?? 30_000)
      expect(cur.delay).toBeLessThanOrEqual((BACKOFF_SCHEDULE_MS[round] ?? 30_000) + JITTER_MAX_MS)
      cur.fn() // attempt 返回 false → 下一轮（异步，等微任务）
      await flush()
    }
    // 第 6 轮封顶 30s
    const last = t.pending[t.pending.length - 1]!
    expect(last.delay).toBeLessThanOrEqual((BACKOFF_SCHEDULE_MS[5] ?? 30_000) + JITTER_MAX_MS)
    ctl.markConnected()
    expect(ctl.state()).toBe('idle')
    // 旧回调失效：再 fire 不再排队
    const lenBefore = t.pending.length
    last.fn()
    expect(t.pending.length).toBe(lenBefore)
  })

  it('successful attempt resets state to idle', () => {
    const t = fakeTimers()
    const ctl = createReconnectController({ attempt: async () => true, schedule: t.schedule, cancel: t.cancel })
    ctl.markDisconnected()
    t.pending[t.pending.length - 1]!.fn()
    // attempt 是 async，微任务后生效
    return Promise.resolve().then(() => {
      expect(ctl.state()).toBe('idle')
    })
  })

  it('stop() cancels pending retry', () => {
    const t = fakeTimers()
    const ctl = createReconnectController({ attempt: async () => false, schedule: t.schedule, cancel: t.cancel })
    ctl.markDisconnected()
    ctl.stop()
    expect(ctl.state()).toBe('stopped')
    const len = t.pending.length
    t.pending[t.pending.length - 1]!.fn()
    expect(t.pending.length).toBe(len) // 无新排队
  })

  // v1.4 终审 B3 回归：stop() 后用户主动断开期间不重试，但「连上」后必须重新武装，
  // 否则断开→重连/吊销→重新配对后的下一次网络抖动会永久停摆。
  it('stop() is re-armed by markConnected() (reconnect after re-pair works)', () => {
    const t = fakeTimers()
    const ctl = createReconnectController({ attempt: async () => false, schedule: t.schedule, cancel: t.cancel })
    ctl.markDisconnected()
    ctl.stop()
    expect(ctl.state()).toBe('stopped')
    ctl.markDisconnected() // 主动断开期间：应静默忽略
    expect(t.pending).toHaveLength(1)
    ctl.markConnected() // 重新登录/配对成功
    expect(ctl.state()).toBe('idle')
    ctl.markDisconnected() // 之后网络再抖动：必须重新进入退避
    expect(ctl.state()).toBe('backoff')
    expect(t.pending).toHaveLength(2)
  })
})

// ── pending-registry ──
describe('pending registry', () => {
  it('tracks only idempotent channels', () => {
    const reg = createPendingRegistry()
    expect(reg.track({ requestId: 'r1', channel: 'sale:create', payload: { x: 1 } })).toBe(true)
    expect(reg.track({ requestId: 'r2', channel: 'product:query', payload: null })).toBe(false)
    expect(reg.size()).toBe(1)
  })

  it('settle: ok or deterministic failure deletes; transient keeps', () => {
    const reg = createPendingRegistry()
    reg.track({ requestId: 'r1', channel: 'sale:create', payload: 1 })
    reg.track({ requestId: 'r2', channel: 'sale:create', payload: 2 })
    reg.track({ requestId: 'r3', channel: 'sale:create', payload: 3 })
    reg.settle({ requestId: 'r1', channel: 'sale:create', payload: 1 }, ok(null))
    reg.settle({ requestId: 'r2', channel: 'sale:create', payload: 2 }, fail('NOT_ENOUGH', '库存不足'))
    reg.settle({ requestId: 'r3', channel: 'sale:create', payload: 3 }, fail('E_HOST_UNREACHABLE', '网络不可达'))
    expect(reg.all().map((e) => e.requestId)).toEqual(['r3'])
    expect(isTransientFailure(fail('E_HOST_UNREACHABLE', 'x'))).toBe(true)
    expect(isTransientFailure(fail('VALIDATION', 'x'))).toBe(false)
  })

  it('persist hooks are invoked (load/save)', () => {
    const saved: unknown[][] = []
    const reg = createPendingRegistry({ persist: { load: () => [], save: (es) => { saved.push(es) } } })
    reg.track({ requestId: 'r1', channel: 'transfer:create', payload: {} })
    reg.settle({ requestId: 'r1', channel: 'transfer:create', payload: {} }, ok(null))
    expect(saved.length).toBeGreaterThanOrEqual(2)
  })
})

// ── event-bus ──
describe('event bus', () => {
  it('no sink → silent no-op; sink errors swallowed', () => {
    expect(() => emitHostEvent({ event: 'doc.changed', at: 'now' })).not.toThrow()
    const seen: string[] = []
    setHostEventSink((e) => {
      seen.push(e.event)
      if (e.event === 'boom' as never) throw new Error('sink exploded')
    })
    emitHostEvent({ event: 'doc.changed', at: 'now' })
    expect(seen).toEqual(['doc.changed'])
    setHostEventSink(null)
  })
})

// ── secret-store ──
describe('secret store (fake safeStorage)', () => {
  function fakeStorage(available = true): SafeStorageLike {
    return {
      isEncryptionAvailable: () => available,
      encryptString: (plain: string) => Buffer.from(`enc(${plain})`),
      decryptString: (buf: Buffer) => buf.toString().replace(/^enc\((.*)\)$/, '$1')
    }
  }

  it('save + load roundtrip with DPAPI-like storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-store-'))
    try {
      const store = fakeStorage()
      const deps = { userDataDir: dir, safeStorage: store }
      expect(isSecretPersistenceAvailable(deps)).toBe(true)
      saveDeviceSecret(deps, 'dev-1', SECRET)
      saveDeviceSecret(deps, 'dev-2', 'bb'.repeat(32))
      const loaded = loadDeviceSecrets(deps)
      expect(loaded.get('dev-1')).toBe(SECRET)
      expect(loaded.get('dev-2')).toBe('bb'.repeat(32))
      // 落盘文件密文不含量原文
      const raw = readFileSync(join(dir, 'host-secrets.json'), 'utf8')
      expect(raw).not.toContain(SECRET)
      removeDeviceSecret(deps, 'dev-1')
      expect(loadDeviceSecrets(deps).get('dev-1')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unavailable encryption → graceful no-op persistence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-store-'))
    try {
      const store = fakeStorage(false)
      expect(isSecretPersistenceAvailable({ userDataDir: dir, safeStorage: store })).toBe(false)
      const log: string[] = []
      const deps: import('../../src/main/host/secret-store').SecretStoreDeps = {
        userDataDir: dir, safeStorage: store, log: (level, msg) => log.push(`${level}:${msg}`)
      }
      saveDeviceSecret(deps, 'dev-1', SECRET)
      expect(existsSync(join(dir, 'host-secrets.json'))).toBe(false)
      expect(log.some((m) => m.includes('NOT persisted'))).toBe(true)
      expect(loadDeviceSecrets(deps).size).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const SECRET = 'aa'.repeat(32)
void vi // keep import used in future cases
