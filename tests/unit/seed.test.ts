import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { seedDemoData } from '../../src/main/db/seed'

describe('seedDemoData', () => {
  it('seeds a self-consistent demo dataset on an empty db', () => {
    const db = openMemDb()
    expect(seedDemoData(db)).toBe(true)

    const products = (db.prepare('SELECT COUNT(*) AS c FROM product').get() as { c: number }).c
    expect(products).toBe(12)
    const customers = (db.prepare('SELECT COUNT(*) AS c FROM customer').get() as { c: number }).c
    expect(customers).toBe(10)
    const suppliers = (db.prepare('SELECT COUNT(*) AS c FROM supplier').get() as { c: number }).c
    expect(suppliers).toBe(6)
    const warehouses = (db.prepare('SELECT COUNT(*) AS c FROM warehouse').get() as { c: number }).c
    expect(warehouses).toBe(2)
    const accounts = (db.prepare('SELECT COUNT(*) AS c FROM fund_account').get() as { c: number }).c
    expect(accounts).toBe(3)

    // 单据全链路
    const docTypes = db
      .prepare('SELECT type, COUNT(*) AS c FROM doc GROUP BY type')
      .all() as Array<{ type: string; c: number }>
    const byType = Object.fromEntries(docTypes.map((r) => [r.type, r.c]))
    expect(byType['purchase']).toBe(2)
    expect(byType['sale']).toBeGreaterThanOrEqual(3)
    expect(byType['retail']).toBe(2)
    expect(byType['receipt']).toBe(2)
    expect(byType['payment']).toBe(1)
    expect(byType['transfer']).toBe(1)
    expect(byType['stocktake']).toBe(1)

    // 转单链：quote→sale_order→sale 各 1 且 approved
    const wf = db
      .prepare("SELECT kind, status, COUNT(*) AS c FROM doc_workflow GROUP BY kind, status")
      .all() as Array<{ kind: string; status: string; c: number }>
    const wfMap = Object.fromEntries(wf.map((r) => [`${r.kind}:${r.status}`, r.c]))
    expect(wfMap['quote:approved']).toBe(1)
    expect(wfMap['sale_order:approved']).toBe(1)
    expect(wfMap['sale:approved']).toBe(1)

    // 价格等级已写入
    const levels = (db.prepare('SELECT COUNT(*) AS c FROM product_price').get() as { c: number }).c
    expect(levels).toBeGreaterThan(0)

    // 期初已建账
    const done = db.prepare("SELECT value FROM app_setting WHERE key='opening.done'").get() as { value: string } | undefined
    expect(done?.value).toBe('1')

    // 序列号台账 3 条
    const sns = (db.prepare('SELECT COUNT(*) AS c FROM serial_number').get() as { c: number }).c
    expect(sns).toBe(3)

    // 库存自洽：SP1001 期初 120 + 采购 50 - 销售 20 - 调拨 6 = 144
    const sp1001 = db
      .prepare(
        `SELECT i.qty FROM inventory i
         JOIN product p ON p.id = i.product_id
         WHERE p.code='SP1001' AND i.warehouse_id=(SELECT id FROM warehouse WHERE name='总店默认仓')`
      )
      .get() as { qty: number } | undefined
    expect(sp1001?.qty).toBe(144)

    // SP1005：期初 120 − 销售 60 − 零售 2 − 盘亏 2 = 54
    const sp1005 = db
      .prepare(
        `SELECT i.qty FROM inventory i
         JOIN product p ON p.id = i.product_id
         WHERE p.code='SP1005' AND i.warehouse_id=(SELECT id FROM warehouse WHERE name='总店默认仓')`
      )
      .get() as { qty: number } | undefined
    expect(sp1005?.qty).toBe(54)

    db.close()
  })

  it('is idempotent: skips when products already exist', () => {
    const db = openMemDb()
    expect(seedDemoData(db)).toBe(true)
    expect(seedDemoData(db)).toBe(false)
    const products = (db.prepare('SELECT COUNT(*) AS c FROM product').get() as { c: number }).c
    expect(products).toBe(12)
    db.close()
  })
})
