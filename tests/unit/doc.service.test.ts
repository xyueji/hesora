import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createDocService } from '../../src/main/services/doc/doc.service'

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('doc.service', () => {
  let s: ReturnType<typeof createDocService>
  beforeEach(() => {
    s = createDocService(openMemDb())
  })

  const purchaseInput = () => ({
    type: 'purchase' as const,
    date: today(),
    partner_id: 1,
    warehouse_id: 1,
    remark: '测试采购',
    items: [
      { product_id: 1, warehouse_id: 1, unit: '个', rate: 1, qty: 2, price: 10 },
      { product_id: 2, warehouse_id: 1, unit: '箱', rate: 12, qty: 1, price: 100 }
    ]
  })

  it('create purchase doc: no format, amounts, total', () => {
    const row = s.create(purchaseInput())
    expect(row.no).toMatch(/^CG\d{8}0001$/)
    expect(row.type).toBe('purchase')
    expect(row.status).toBe('done')
    const items = s.getItems(row.id)
    expect(items).toHaveLength(2)
    expect(items[0]!.amount).toBe(20)
    expect(items[1]!.amount).toBe(100)
    expect(s.getById(row.id)?.total_amount).toBe(120)
  })

  it('second doc same day/type gets 0002', () => {
    s.create(purchaseInput())
    const row = s.create(purchaseInput())
    expect(row.no).toMatch(/^CG\d{8}0002$/)
  })

  it('continues the sequence beyond four digits', () => {
    const db = openMemDb()
    const svc = createDocService(db)
    const date = '2026-11-07'
    const insert = db.prepare("INSERT INTO doc (no, type, date) VALUES (?, 'purchase', ?)")
    insert.run('CG202611079999', date)
    insert.run('CG2026110710000', date)
    expect(svc.create({ ...purchaseInput(), date }).no).toBe('CG2026110710001')
  })

  it.each([0, -1, Infinity, NaN])('rejects an invalid unit conversion rate %s', (rate) => {
    expect(() =>
      s.create({ ...purchaseInput(), items: [{ product_id: 1, qty: 1, rate, price: 10 }] })
    ).toThrowError(/换算率/)
  })

  it('different type same day gets its own sequence', () => {
    s.create(purchaseInput())
    const row = s.create({ ...purchaseInput(), type: 'sale' as const })
    expect(row.no).toMatch(/^XS\d{8}0001$/)
  })

  it('different date gets 0001 again', () => {
    s.create(purchaseInput())
    const row = s.create({ ...purchaseInput(), date: '2025-11-06' })
    expect(row.no).toBe('CG202511060001')
  })

  it('empty items throws VALIDATION', () => {
    expect(() => s.create({ ...purchaseInput(), items: [] })).toThrowError(/VALIDATION|不能为空/)
  })

  it('qty 0 throws VALIDATION', () => {
    expect(() =>
      s.create({ ...purchaseInput(), items: [{ product_id: 1, qty: 0, price: 10 }] })
    ).toThrowError(/数量必须大于0/)
  })

  it('query filters by type and keyword', () => {
    s.create(purchaseInput())
    const sale = s.create({ ...purchaseInput(), type: 'sale' as const })
    expect(s.query({ type: 'purchase', page: 1, pageSize: 10 }).total).toBe(1)
    expect(s.query({ page: 1, pageSize: 10 }).total).toBe(2)
    expect(s.query({ keyword: sale.no.slice(-4), page: 1, pageSize: 10 }).items[0]?.id).toBe(sale.id)
    expect(s.query({ keyword: 'NOPE', page: 1, pageSize: 10 }).total).toBe(0)
  })

  it('query filters by date range', () => {
    s.create({ ...purchaseInput(), date: '2025-11-01' })
    s.create({ ...purchaseInput(), date: '2025-11-20' })
    expect(s.query({ date_from: '2025-11-10', date_to: '2025-11-30', page: 1, pageSize: 10 }).total).toBe(1)
  })

  it('query filters by partner_id', () => {
    s.create({ ...purchaseInput(), partner_id: 1 })
    s.create({ ...purchaseInput(), partner_id: 2 })
    expect(s.query({ partner_id: 1, page: 1, pageSize: 10 }).total).toBe(1)
    expect(s.query({ partner_id: 2, page: 1, pageSize: 10 }).items[0]?.partner_id).toBe(2)
    expect(s.query({ partner_id: 3, page: 1, pageSize: 10 }).total).toBe(0)
    // 不传 partner_id 不过滤
    expect(s.query({ page: 1, pageSize: 10 }).total).toBe(2)
  })

  it('remove always throws DOC_DONE', () => {
    const row = s.create(purchaseInput())
    try {
      s.remove(row.id)
      expect.unreachable()
    } catch (e) {
      expect((e as { code?: string }).code).toBe('DOC_DONE')
    }
  })

  it('getById returns null for missing doc', () => {
    expect(s.getById(999)).toBeNull()
  })

  describe('partner_name resolution', () => {
    it('filters by partner name and resolves overlapping customer and supplier ids', () => {
      const db = openMemDbWithPartners()
      db.prepare(`INSERT INTO supplier (id, code, name) VALUES (101, 'S101', '同号供货商')`).run()
      const svc = createDocService(db)
      svc.create({ ...purchaseInput(), type: 'sale', partner_id: 101 })
      const purchase = svc.create({ ...purchaseInput(), partner_id: 101 })
      const results = svc.query({ partner_keyword: '供货商', page: 1, pageSize: 10 })
      expect(results.total).toBe(1)
      expect(results.items[0]?.partner_name).toBe('同号供货商')
      expect(svc.getDetailWithItems(purchase.id)?.doc.partner_name).toBe('同号供货商')
    })

    it('query returns partner_name for customer/supplier and null for retail', () => {
      const svc = createDocService(openMemDbWithPartners())
      const sale = svc.create({ ...purchaseInput(), type: 'sale' as const, partner_id: 101 })
      const purchase = svc.create({ ...purchaseInput(), partner_id: 201 })
      const retail = svc.create({
        ...purchaseInput(),
        type: 'retail' as const,
        partner_id: null as unknown as number
      })
      const rows = svc.query({ page: 1, pageSize: 10 }).items
      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get(sale.id)?.partner_name).toBe('测试客户')
      expect(byId.get(purchase.id)?.partner_name).toBe('测试供应商')
      expect(byId.get(retail.id)?.partner_name ?? null).toBeNull()
    })

    it('getDetailWithItems returns doc and items', () => {
      const svc = createDocService(openMemDbWithPartners())
      const row = svc.create(purchaseInput())
      const d = svc.getDetailWithItems(row.id)
      expect(d?.doc.id).toBe(row.id)
      expect(d?.items).toHaveLength(2)
      expect(svc.getDetailWithItems(999)).toBeNull()
    })
  })
})

/** 内存库 + 预置一个客户(id 101)和一个供应商(id 201) */
function openMemDbWithPartners(): import('better-sqlite3').Database {
  const db = openMemDb()
  db.prepare(`INSERT INTO customer (id, code, name) VALUES (101, 'C101', '测试客户')`).run()
  db.prepare(`INSERT INTO supplier (id, code, name) VALUES (201, 'S201', '测试供应商')`).run()
  return db
}
