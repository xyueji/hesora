import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createGateway } from '../../src/main/host/gateway'
import { ok, BizError, type IpcHandler } from '../../src/shared/result'
import type { SessionContext } from '../../src/main/host/host-protocol'
import type { DB } from '../../src/main/db'
import { setCurrentUser, canFor, installUserLookup } from '../../src/main/auth'
import { createSaleService } from '../../src/main/services/sale/sale.service'

function setup(handlers: { channel: string; handler: IpcHandler }[], db = openMemDb()) {
  const map = new Map(handlers.map((h) => [h.channel, h]))
  const gw = createGateway({ getDb: () => db as unknown as DB, handlers: map })
  return { gw, db }
}

const session: SessionContext = { deviceId: 'dev-1', userId: 1 }

describe('gateway routing', () => {
  it('local-prefix channel → E_LOCAL_ONLY', async () => {
    const { gw } = setup([{ channel: 'license:check', handler: () => 1 }])
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'license:check', payload: null }, session)).code).toBe('E_LOCAL_ONLY')
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'window:minimize', payload: null }, session)).code).toBe('E_LOCAL_ONLY')
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'print:receipt', payload: null }, session)).code).toBe('E_LOCAL_ONLY')
  })

  it('host-only prefixes backup:/sync: → E_HOST_ONLY', async () => {
    const { gw } = setup([])
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'backup:now', payload: null }, session)).code).toBe('E_HOST_ONLY')
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'sync:now', payload: null }, session)).code).toBe('E_HOST_ONLY')
  })

  it('unknown channel → NOT_FOUND', async () => {
    const { gw } = setup([])
    const r = await gw.handleRpc({ requestId: 'r1', channel: 'nope:thing', payload: null }, session)
    expect(r.code).toBe('NOT_FOUND')
    expect(r.ok).toBe(false)
  })

  it('plain channel dispatches handler with payload, wraps result', async () => {
    const { gw } = setup([{ channel: 'product:query', handler: (_e, p) => ({ got: p }) }])
    const r = await gw.handleRpc({ requestId: 'r1', channel: 'product:query', payload: { q: 'x' } }, session)
    expect(r).toEqual(ok({ got: { q: 'x' } }))
  })

  it('handler throws plain Error → INTERNAL, not cached on idempotent channel (retryable)', async () => {
    let calls = 0
    const { gw } = setup([{ channel: 'sale:create', handler: () => { calls++; throw new TypeError('boom') } }])
    const r1 = await gw.handleRpc({ requestId: 'r1', channel: 'sale:create', payload: {} }, session)
    expect(r1.code).toBe('INTERNAL')
    const r2 = await gw.handleRpc({ requestId: 'r1', channel: 'sale:create', payload: {} }, session)
    expect(r2.code).toBe('INTERNAL')
    expect(calls).toBe(2)
  })

  it('idempotent channel: 100 replays of same requestId return same cached result, handler called once', async () => {
    let calls = 0
    const { gw } = setup([{ channel: 'transfer:create', handler: () => { calls++; return { id: 1 } } }])
    const first = await gw.handleRpc({ requestId: 'r1', channel: 'transfer:create', payload: { x: 1 } }, session)
    for (let i = 0; i < 100; i++) {
      const r = await gw.handleRpc({ requestId: 'r1', channel: 'transfer:create', payload: { x: 1 } }, session)
      expect(r).toEqual(first)
    }
    expect(calls).toBe(1)
  })

  it('idempotent: sale of last item — first create ok, replay returns same doc, stock moves once; second sale NOT_ENOUGH cached', async () => {
    const db = openMemDb()
    db.prepare("INSERT INTO warehouse (id, code, name) VALUES (1, 'W', 'w')").run()
    db.prepare("INSERT INTO product (id, code, name, retail_price, trade_price, purchase_price, base_unit) VALUES (1, 'P1', 'p', 1, 1, 1, '件')").run()
    db.prepare("INSERT INTO inventory (product_id, warehouse_id, batch_no, qty, moving_cost) VALUES (1, 1, '', 1, 1)").run()
    const saleSvc = createSaleService(db as unknown as DB)
    const { gw } = setup(
      [{ channel: 'sale:create', handler: (_e, payload) => saleSvc.create(payload as never) }],
      db
    )
    const payload = { warehouse_id: 1, items: [{ product_id: 1, qty: 1, price: 1 }] }
    const r1 = await gw.handleRpc({ requestId: 'sale-1', channel: 'sale:create', payload }, session)
    expect(r1.ok).toBe(true)
    const r2 = await gw.handleRpc({ requestId: 'sale-1', channel: 'sale:create', payload }, session)
    expect(r2).toEqual(r1)
    const qty = db.prepare('SELECT qty FROM inventory WHERE product_id=1 AND warehouse_id=1').get() as { qty: number }
    expect(qty.qty).toBe(0)
    const r3 = await gw.handleRpc({ requestId: 'sale-2', channel: 'sale:create', payload }, session)
    expect(r3.code).toBe('NOT_ENOUGH')
    const r4 = await gw.handleRpc({ requestId: 'sale-2', channel: 'sale:create', payload }, session)
    expect(r4).toEqual(r3)
  })

  it('same requestId different payload on idempotent channel → E_REQUEST_ID_CONFLICT, original cached result intact', async () => {
    const { gw } = setup([{ channel: 'transfer:create', handler: () => ({ id: 1 }) }])
    await gw.handleRpc({ requestId: 'r1', channel: 'transfer:create', payload: { x: 1 } }, session)
    const r = await gw.handleRpc({ requestId: 'r1', channel: 'transfer:create', payload: { x: 2 } }, session)
    expect(r.code).toBe('E_REQUEST_ID_CONFLICT')
    const again = await gw.handleRpc({ requestId: 'r1', channel: 'transfer:create', payload: { x: 1 } }, session)
    expect(again).toEqual(ok({ id: 1 }))
  })
})

describe('gateway session isolation', () => {
  let db: ReturnType<typeof openMemDb>
  beforeEach(() => { db = openMemDb() })

  it('handler receives session with userId — no global currentUser involved', async () => {
    db.prepare("INSERT INTO \"user\" (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'admin'), (2, 'cashier', 'x', 'cashier')").run()
    setCurrentUser(null)
    const { gw } = setup([{ channel: 'product:costMap', handler: (_e, _p, s) => (s as SessionContext | undefined)?.userId ?? null }])
    expect((await gw.handleRpc({ requestId: 'r1', channel: 'product:costMap', payload: null }, { deviceId: 'd', userId: 1 })).data).toBe(1)
    expect((await gw.handleRpc({ requestId: 'r2', channel: 'product:costMap', payload: null }, { deviceId: 'd', userId: 2 })).data).toBe(2)
    expect((await gw.handleRpc({ requestId: 'r3', channel: 'product:costMap', payload: null }, session)).data).toBe(1)
  })

  it('canFor gates permissions per session user (admin ok, cashier denied on doc.approve write)', async () => {
    db.prepare("INSERT INTO \"user\" (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'admin'), (2, 'cashier', 'x', 'cashier')").run()
    setCurrentUser(null)
    // 模拟 handlers.ts 中 purchase:create 改造后的形态：canFor('doc.approve') 判定走 session
    // （真实路径 main 启动时 installUserLookup(userSvc.sessionById)；测试直接查库模拟）
    const rowById = (id: number) => db.prepare('SELECT id, username, role FROM \"user\" WHERE id = ?').get(id) as { id: number; username: string; role: string } | undefined
    installUserLookup((id) => { const r = rowById(id); return r ? { ...r, roleName: r.role } : null })
    const { gw } = setup([{ channel: 'purchase:create', handler: (_e, _p, s) => {
      if (!s || !canFor((s as SessionContext).userId, 'doc.approve')) throw new BizError('FORBIDDEN', '无审核权限')
      return { who: (s as SessionContext).userId }
    } }])
    const okR = await gw.handleRpc({ requestId: 'r1', channel: 'purchase:create', payload: null }, { deviceId: 'd', userId: 1 })
    expect(okR.ok).toBe(true)
    const denied = await gw.handleRpc({ requestId: 'r2', channel: 'purchase:create', payload: null }, { deviceId: 'd', userId: 2 })
    expect(denied.code).toBe('FORBIDDEN')
  })

  it('deterministic BizError from handler (FORBIDDEN) is cached on idempotent channel', async () => {
    db.prepare("INSERT INTO \"user\" (id, username, password_hash, role) VALUES (2, 'cashier', 'x', 'cashier')").run()
    setCurrentUser(null)
    let calls = 0
    const { gw } = setup([{ channel: 'purchase:create', handler: (_e, _p, s) => {
      calls++
      if (!s || (s as SessionContext).userId !== 1) throw new BizError('FORBIDDEN', '无审核权限')
      return 1
    } }])
    const denied = await gw.handleRpc({ requestId: 'r1', channel: 'purchase:create', payload: null }, { deviceId: 'd', userId: 2 })
    expect(denied.code).toBe('FORBIDDEN')
    expect(calls).toBe(1)
    const replay = await gw.handleRpc({ requestId: 'r1', channel: 'purchase:create', payload: null }, { deviceId: 'd', userId: 2 })
    expect(replay).toEqual(denied)
    expect(calls).toBe(1) // 确定性失败被缓存，handler 未再次执行
  })
})
