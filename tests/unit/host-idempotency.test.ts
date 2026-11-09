import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { openMemDb } from '../helpers/mem-db'
import { createIdempotencyStore } from '../../src/main/host/idempotency'
import { ok, fail, BizError } from '../../src/shared/result'
import type Database from 'better-sqlite3'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

describe('idempotency store', () => {
  let db: Database.Database
  let store: ReturnType<typeof createIdempotencyStore>

  beforeEach(() => {
    db = openMemDb()
    store = createIdempotencyStore(db)
  })

  it('fresh → handler → commit → replay returns cached result', () => {
    const hash = store.hashOf('sale:create', { a: 1 })
    expect(store.begin('req-1', 'sale:create', 'dev-1', hash)).toBe('fresh')
    store.commit('req-1', ok({ id: 7 }))
    expect(store.begin('req-1', 'sale:create', 'dev-1', hash)).toBe('replay')
    const cached = store.replay('req-1')
    expect(cached).toEqual(ok({ id: 7 }))
  })

  it('same requestId different payload hash → conflict (E_REQUEST_ID_CONFLICT)', () => {
    const h1 = store.hashOf('sale:create', { a: 1 })
    const h2 = store.hashOf('sale:create', { a: 2 })
    expect(store.begin('req-1', 'sale:create', 'dev-1', h1)).toBe('fresh')
    expect(() => store.begin('req-1', 'sale:create', 'dev-1', h2)).toThrowError(BizError)
    // 原记录不受影响，仍可 replay
    expect(store.begin('req-1', 'sale:create', 'dev-1', h1)).toBe('replay')
  })

  it('same payload different requestId → two fresh', () => {
    const h = store.hashOf('sale:create', { a: 1 })
    expect(store.begin('r1', 'sale:create', 'dev-1', h)).toBe('fresh')
    expect(store.begin('r2', 'sale:create', 'dev-1', h)).toBe('fresh')
  })

  it('same requestId different channel → conflict', () => {
    const h1 = store.hashOf('sale:create', { a: 1 })
    const h2 = store.hashOf('transfer:create', { a: 1 })
    expect(store.begin('req-1', 'sale:create', 'dev-1', h1)).toBe('fresh')
    expect(() => store.begin('req-1', 'transfer:create', 'dev-1', h2)).toThrowError(BizError)
  })

  it('deterministic failure result is cached and replayed', () => {
    const h = store.hashOf('sale:create', {})
    store.begin('req-1', 'sale:create', 'dev-1', h)
    store.commit('req-1', fail('NOT_ENOUGH', '库存不足'))
    expect(store.replay('req-1')).toEqual(fail('NOT_ENOUGH', '库存不足'))
  })

  it('non-deterministic failure: abort leaves no record → retry is fresh', () => {
    const h = store.hashOf('sale:create', {})
    store.begin('req-1', 'sale:create', 'dev-1', h)
    store.abort('req-1')
    expect(store.begin('req-1', 'sale:create', 'dev-1', h)).toBe('fresh')
  })

  it('replay of unknown requestId → null', () => {
    expect(store.replay('nope')).toBeNull()
  })

  it('cleanup: entries older than 90 days are purged', () => {
    const h = store.hashOf('sale:create', {})
    const old = Date.now() - 91 * 24 * 3600 * 1000
    db.prepare('INSERT INTO command_results (request_id, channel, device_id, request_hash, result_json, created_at) VALUES (?,?,?,?,?,?)')
      .run('old', 'sale:create', 'dev-1', h, JSON.stringify(ok(1)), new Date(old).toISOString())
    db.prepare('INSERT INTO command_results (request_id, channel, device_id, request_hash, result_json, created_at) VALUES (?,?,?,?,?,?)')
      .run('new', 'sale:create', 'dev-1', h, JSON.stringify(ok(1)), new Date().toISOString())
    const now = Date.now()
    store.cleanup(now)
    expect(store.replay('old')).toBeNull()
    expect(store.replay('new')).toEqual(ok(1))
  })

  it('cleanup: per-device cap 1000 keeps newest, drops oldest', () => {
    const h = store.hashOf('sale:create', {})
    const ins = db.prepare('INSERT INTO command_results (request_id, channel, device_id, request_hash, result_json, created_at) VALUES (?,?,?,?,?,?)')
    for (let i = 0; i < 1005; i++) {
      ins.run(`d-${i}`, 'sale:create', 'dev-cap', h, JSON.stringify(ok(i)), new Date(Date.now() - (1005 - i) * 1000).toISOString())
    }
    // 其他设备不受影响
    ins.run('other', 'sale:create', 'dev-other', h, JSON.stringify(ok(1)), new Date().toISOString())
    store.cleanup(Date.now())
    expect(store.replay('d-0')).toBeNull()
    expect(store.replay('d-4')).toBeNull()
    expect(store.replay('d-5')).not.toBeNull()
    expect(store.replay('d-1004')).not.toBeNull()
    expect(store.replay('other')).not.toBeNull()
    const count = db.prepare('SELECT COUNT(*) AS n FROM command_results WHERE device_id = ?').get('dev-cap') as { n: number }
    expect(count.n).toBe(1000)
  })

  it('hashOf is sha256(channel + "\\n" + JSON.stringify(payload))', () => {
    const payload = { b: 2, a: 1 }
    expect(store.hashOf('sale:create', payload)).toBe(sha256('sale:create\n' + JSON.stringify(payload)))
  })
})
