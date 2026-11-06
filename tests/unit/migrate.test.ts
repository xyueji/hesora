import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
describe('migrations', () => {
  it('applies 001_init and creates tables', () => {
    const db = openMemDb()
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {name:string}[]
    const names = rows.map(r => r.name)
    for (const t of ['product','product_barcode','product_unit','product_price','customer','supplier','warehouse','fund_account','inventory','cost_log','app_setting']) expect(names).toContain(t)
  })
  it('is idempotent via user_version', () => {
    const db = openMemDb()
    expect(db.pragma('user_version', { simple: true })).toBe(4)
  })
  it('003 adds product.kind and bom_item table', () => {
    const db = openMemDb()
    const cols = db.prepare('PRAGMA table_info(product)').all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('kind')
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {name:string}[]).map(r => r.name)
    expect(tables).toContain('bom_item')
  })
  it('004 adds fund_flow table with indexes', () => {
    const db = openMemDb()
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {name:string}[]).map(r => r.name)
    expect(tables).toContain('fund_flow')
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as {name:string}[]).map(r => r.name)
    expect(idx).toContain('idx_fund_flow_account')
    expect(idx).toContain('idx_fund_flow_date')
  })
})
