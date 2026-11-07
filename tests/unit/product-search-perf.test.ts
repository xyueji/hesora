import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../src/main/db/migrate'
import { join } from 'node:path'
import { createProductService } from '../../src/main/services/product/product.service'

// 性能基准：万级商品搜索 < 50ms（AGENTS.md §5 生产可用标准）。
describe('product search performance (10k products)', () => {
  function seedTenThousand(): Database.Database {
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    runMigrations(db, join(__dirname, '../../src/main/db/migrations'))
    const svc = createProductService(db)
    db.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        svc.create({
          code: `SKU${String(i).padStart(6, '0')}`,
          name: i % 7 === 0 ? `可乐${i}号` : `商品${i}`,
          base_unit: '个',
          retail_price: 10 + (i % 50),
          trade_price: 9 + (i % 50),
          purchase_price: 6 + (i % 40),
          kind: 'standard',
          tracking_type: 'none'
        } as never)
      }
      // 为部分商品加条码，验证 barcode 路径也在预算内
      const insBc = db.prepare('INSERT INTO product_barcode (product_id, barcode) VALUES (?, ?)')
      for (let i = 0; i < 10000; i += 10) {
        const id = db.prepare('SELECT id FROM product WHERE code = ?').get(`SKU${String(i).padStart(6, '0')}`) as { id: number }
        insBc.run(id.id, `BC${String(i).padStart(6, '0')}`)
      }
    })()
    return db
  }

  it('exact-code, prefix-name and barcode queries all finish within 50ms at 10k products', () => {
    const db = seedTenThousand()
    const svc = createProductService(db)

    const cases: Array<[string, () => unknown]> = [
      ['exact code', () => svc.query({ keyword: 'SKU009999', pageSize: 20 })],
      ['name prefix', () => svc.query({ keyword: '可乐90', pageSize: 20 })],
      ['name contains', () => svc.query({ keyword: '90号', pageSize: 20 })],
      ['barcode exact', () => svc.query({ keyword: 'BC005000', pageSize: 20 })],
      ['common fragment', () => svc.query({ keyword: '商品9', pageSize: 20 })],
      ['single char wide', () => svc.query({ keyword: '号', pageSize: 20 })]
    ]
    for (const [label, run] of cases) {
      const start = performance.now()
      const result = run() as { total: number }
      const ms = performance.now() - start
      expect(result.total).toBeGreaterThan(0)
      expect(ms, `${label} took ${ms.toFixed(1)}ms`).toBeLessThan(50)
    }
    db.close()
  })
})
