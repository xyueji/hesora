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
    expect(items[1]!.amount).toBe(1200)
    expect(s.getById(row.id)?.total_amount).toBe(1220)
  })

  it('second doc same day/type gets 0002', () => {
    s.create(purchaseInput())
    const row = s.create(purchaseInput())
    expect(row.no).toMatch(/^CG\d{8}0002$/)
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
})
