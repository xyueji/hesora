import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createEventHub, type WsLike, type SessionContext } from '../../src/main/host/events'

type TestWs = WsLike & EventEmitter & { sent: unknown[] }

function fakeWs(): TestWs {
  const ee = new EventEmitter() as TestWs
  ee.sent = []
  ee.send = (s: string) => ee.sent.push(JSON.parse(s))
  ee.close = vi.fn()
  return ee
}

const session: SessionContext = { deviceId: 'dev-1', userId: 1 }

function last(evts: unknown[]): Record<string, unknown> | undefined {
  return evts.at(-1) as Record<string, unknown> | undefined
}

describe('event hub', () => {
  it('订阅→回 subscribed；广播只发给订阅了该事件的连接', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, () => true)
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['doc.changed', 'inventory.changed'] }))
    expect(conn.sent).toEqual([{ type: 'subscribed', events: ['doc.changed', 'inventory.changed'] }])

    hub.broadcast({ event: 'doc.changed', at: '2026-11-09T00:00:00Z', summary: { docNo: 'S001' } })
    expect(last(conn.sent)?.event).toBe('doc.changed')

    hub.broadcast({ event: 'master.changed', at: '2026-11-09T00:00:00Z', summary: { entity: 'product' } })
    expect(last(conn.sent)?.event).toBe('doc.changed') // 未订阅 master.changed → 仍停在上一条
  })

  it('未订阅的事件不推送', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, () => true)
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['doc.changed'] }))
    const n = conn.sent.length
    hub.broadcast({ event: 'master.changed', at: '2026-11-09T00:00:00Z', summary: { entity: 'customer' } })
    expect(conn.sent.length).toBe(n)
  })

  it('权限过滤：有权限收到，无权限不收', () => {
    const hub = createEventHub()
    const allowed = fakeWs()
    const denied = fakeWs()
    hub.registerConnection(allowed, session, (uid, key) => uid === 1 && key === 'doc.viewAll')
    hub.registerConnection(denied, { deviceId: 'dev-2', userId: 2 }, () => false)
    for (const c of [allowed, denied]) c.emit('message', JSON.stringify({ type: 'subscribe', events: ['doc.changed'] }))

    hub.broadcast({ event: 'doc.changed', at: '2026-11-09T00:00:00Z', summary: { docNo: 'S002' } })
    expect(last(allowed.sent)?.event).toBe('doc.changed')
    expect(denied.sent.length).toBe(1) // 只有 subscribed
  })

  it('master.changed：任一主档 view 权限即可（customer/product/supplier）', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, (_uid, key) => key === 'product.view')
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['master.changed'] }))
    hub.broadcast({ event: 'master.changed', at: '2026-11-09T00:00:00Z', summary: { entity: 'product' } })
    expect(last(conn.sent)?.event).toBe('master.changed')
  })

  it('inventory.changed 需要 inventory.report', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, (_uid, key) => key === 'inventory.report')
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['inventory.changed'] }))
    hub.broadcast({ event: 'inventory.changed', at: '2026-11-09T00:00:00Z', summary: { count: 3 } })
    expect(last(conn.sent)?.event).toBe('inventory.changed')
  })

  it('概要红线：事件明细数组不会出现在推送 JSON 中', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, () => true)
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['doc.changed'] }))
    // 模拟调用方误传全文（含明细行）
    hub.broadcast({
      event: 'doc.changed',
      at: '2026-11-09T00:00:00Z',
      summary: { docNo: 'S003' },
      // 故意传非法字段验证红线剥离（运行时剥离，类型上此处强制 as 绕过）
      details: [{ name: '可乐', qty: 5, price: 3.5 }]
    } as unknown as Parameters<typeof hub.broadcast>[0])
    const raw = JSON.stringify(last(conn.sent))
    expect(raw).not.toContain('可乐')
    expect(raw).not.toContain('details')
    expect(raw).toContain('S003')
  })

  it('畸形 subscribe 消息被忽略（不回 subscribed、不崩溃）', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, () => true)
    conn.emit('message', 'not-json')
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: 'doc.changed' }))
    conn.emit('message', JSON.stringify({ type: 'other' }))
    expect(conn.sent).toEqual([])
  })

  it('close→清理注册表，之后不再推送', () => {
    const hub = createEventHub()
    const conn = fakeWs()
    hub.registerConnection(conn, session, () => true)
    conn.emit('message', JSON.stringify({ type: 'subscribe', events: ['doc.changed'] }))
    conn.emit('close')
    hub.broadcast({ event: 'doc.changed', at: '2026-11-09T00:00:00Z', summary: { docNo: 'S004' } })
    expect(conn.sent.length).toBe(1)
  })

  it('ping：25s 发 ping；60s 无 pong 关闭连接（假时钟）', () => {
    vi.useFakeTimers()
    try {
      const hub = createEventHub({ pingIntervalMs: 25_000, pongTimeoutMs: 60_000 })
      const conn = fakeWs()
      hub.registerConnection(conn, session, () => true)
      vi.advanceTimersByTime(25_000)
      expect(last(conn.sent)?.type).toBe('ping')
      vi.advanceTimersByTime(60_000)
      expect(conn.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pong 重置存活计时，长连接不被误杀', () => {
    vi.useFakeTimers()
    try {
      const hub = createEventHub({ pingIntervalMs: 25_000, pongTimeoutMs: 60_000 })
      const conn = fakeWs()
      hub.registerConnection(conn, session, () => true)
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(25_000)
        conn.emit('message', JSON.stringify({ type: 'pong' }))
      }
      expect(conn.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
