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
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })
})
