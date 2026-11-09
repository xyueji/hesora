import { afterEach, beforeEach, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/db'
import { resolveDatabasePath } from '../../src/main/db/location'
import { resolveProfilePath } from '../../src/main/db/profile'
import { runMigrations } from '../../src/main/db/migrate'
import { applyPendingRestore, createBackupService } from '../../src/main/services/backup/backup.service'
import { createUserService } from '../../src/main/services/user/user.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createDocService } from '../../src/main/services/doc/doc.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createWorkflowService } from '../../src/main/services/workflow/workflow.service'

const migrations = join(process.cwd(), 'src/main/db/migrations')
let temp: string
let db: Database.Database | undefined
beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'hesora-legacy-acceptance-')) })
afterEach(() => {
  db?.close()
  db = undefined
  rmSync(temp, { recursive: true, force: true })
})

it('upgrades a version 21 account and safely restores the original snapshot with historical links', () => {
  const oldMigrations = join(temp, 'old-migrations')
  const legacyProfile = join(temp, 'zhjs-erp')
  mkdirSync(oldMigrations)
  mkdirSync(legacyProfile)
  for (const name of readdirSync(migrations).filter((name) => /^\d+_.*\.sql$/.test(name) && Number(name.split('_')[0]) <= 21)) {
    copyFileSync(join(migrations, name), join(oldMigrations, name))
  }

  const legacyDb = join(legacyProfile, 'zhjs-erp.db')
  db = openDb(legacyDb, oldMigrations)
  expect(db.pragma('user_version', { simple: true })).toBe(21)
  // 基线随迁移演进至 021（doc.operator/income_category 已就位），fixture 可直接用现有服务造数据。
  // S 批次 B 起 customer.service 写入 email/category（迁移 039）；legacy 库停在 21，此处按服务当前
  // 所需列补齐（幂等，仅当列缺失时添加），避免 fixture 建数据因缺列失败。
  const legacyCols = (db.prepare('PRAGMA table_info(customer)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!legacyCols.includes('email')) db.exec("ALTER TABLE customer ADD COLUMN email TEXT")
  if (!legacyCols.includes('category')) db.exec("ALTER TABLE customer ADD COLUMN category TEXT NOT NULL DEFAULT ''")
  // S 批次 B：doc.service 写入 external_no/invoice_status/express_*/delivery_status（迁移 038），legacy 库同样补齐
  const docCols = (db.prepare('PRAGMA table_info(doc)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!docCols.includes('external_no')) db.exec('ALTER TABLE doc ADD COLUMN external_no TEXT')
  if (!docCols.includes('invoice_status')) db.exec("ALTER TABLE doc ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'none'")
  if (!docCols.includes('express_com')) db.exec('ALTER TABLE doc ADD COLUMN express_com TEXT')
  if (!docCols.includes('express_no')) db.exec('ALTER TABLE doc ADD COLUMN express_no TEXT')
  if (!docCols.includes('delivery_status')) db.exec("ALTER TABLE doc ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'none'")
  // P1 功能 #2 预存款：doc.prepaid_amount/charge_type（迁移 029），legacy 库同样补齐（实时重查列，幂等）
  const docCols2 = (db.prepare('PRAGMA table_info(doc)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!docCols2.includes('prepaid_amount')) db.exec('ALTER TABLE doc ADD COLUMN prepaid_amount REAL NOT NULL DEFAULT 0')
  if (!docCols2.includes('charge_type')) db.exec("ALTER TABLE doc ADD COLUMN charge_type TEXT NOT NULL DEFAULT 'normal'")
  const owner = createUserService(db).setupAdmin('旧账管理员', 'legacy-owner-password')
  db.prepare("INSERT INTO app_setting VALUES ('shop.name', '老店'), ('license.install_id', 'legacy-device')").run()
  const customer = createCustomerService(db).create({ code: 'C18', name: '旧客户', opening_receivable: 5 })
  const account = createFundService(db).create({ name: '旧现金', type: 'cash' })
  const warehouse = Number(db.prepare("INSERT INTO warehouse (code, name) VALUES ('W18', '旧仓')").run().lastInsertRowid)
  const product = createProductService(db).create({
    code: 'P18', name: '旧配件', base_unit: '件', retail_price: 10, trade_price: 10, purchase_price: 4, tracking_type: 'none'
  })
  const date = '2026-11-01'
  const item = { product_id: product, unit: '件', qty: 4, price: 10 }
  createPurchaseService(db).create({ date, warehouse_id: warehouse, items: [{ ...item, qty: 10, price: 4 }] })
  const sale = createSaleService(db).create({ date, warehouse_id: warehouse, customer_id: customer, items: [item] })
  const receipt = createDocService(db).create({
    type: 'receipt', date, partner_id: customer, account_id: account, items: [{ product_id: 0, qty: 1, price: 15 }]
  })
  db.prepare("INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date) VALUES (?, 'receipt', ?, 15, 'in', ?)")
    .run(account, receipt.id, date)
  const workflow = createWorkflowService(db)
  const order = workflow.save({ kind: 'sale_order', date, warehouse_id: warehouse, partner_id: customer, items: [item] }, owner.id)
  workflow.approve(order.id, owner.id)
  const historical = Number(db.prepare("INSERT INTO doc_workflow (kind, status, body, source_id, posted_doc_id) VALUES ('sale', 'approved', ?, ?, ?)")
    .run(JSON.stringify({ date, warehouse_id: warehouse, partner_id: customer, items: [item] }), order.id, sale.id).lastInsertRowid)
  // 造数用的服务层 INSERT 引用了迁移 029/038/039 才会添加的列（见上方补列）。快照必须还原为
  // 纯 v21 schema，否则后续 runMigrations 再 ADD COLUMN 会撞 duplicate column。造数完成后
  // 用 DROP COLUMN（SQLite ≥3.35）撤掉全部补列——数据行的这些列均为 NULL/默认值，可安全删除。
  for (const [table, col] of [
    ['customer', 'email'], ['customer', 'category'],
    ['doc', 'external_no'], ['doc', 'invoice_status'], ['doc', 'express_com'], ['doc', 'express_no'], ['doc', 'delivery_status'],
    ['doc', 'prepaid_amount'], ['doc', 'charge_type']
  ] as Array<[string, string]>) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`)
  }
  db.close()
  const oldSnapshot = join(temp, 'old-backup.db')
  copyFileSync(legacyDb, oldSnapshot)

  const profile = resolveProfilePath(temp)
  const currentDb = resolveDatabasePath(profile)
  expect(currentDb).toBe(join(temp, 'hesora-inventory', 'hesora-inventory.db'))
  db = openDb(currentDb, migrations)

  function verifyHistory(current: Database.Database) {
    expect(createUserService(current).verify('旧账管理员', 'legacy-owner-password')?.id).toBe(owner.id)
    expect(createProductService(current).getById(product)?.name).toBe('旧配件')
    expect(createInventoryService(current).getByProduct(product, warehouse)[0]?.qty).toBe(6)
    expect(createArrearsService(current).receivables()[0]).toMatchObject({ opening: 5, amount: 40, settled: 15, balance: 30 })
    expect(createPaymentService(current).getReceiptDetail(receipt.id)).toMatchObject({ allocations: [], flows: [{ amount: 15 }] })
    const workflow = createWorkflowService(current)
    expect(workflow.get(order.id).fulfillment).toMatchObject({ state: 'legacy', batches: [{ id: historical, postedNo: sale.no }] })
    expect(() => workflow.convert(order.id, owner.id, 'sale', [{ line: 0, qty: 1 }])).toThrow(/已转单/)
  }

  verifyHistory(db)
  db.prepare("UPDATE app_setting SET value = 'this-device' WHERE key = 'license.install_id'").run()
  db.prepare("UPDATE app_setting SET value = '新店' WHERE key = 'shop.name'").run()
  const service = createBackupService(db, currentDb, (candidate) => runMigrations(candidate, migrations))
  service.restoreFrom(oldSnapshot, currentDb, join(profile, 'backups'), owner.username)
  expect(db.prepare("SELECT value FROM app_setting WHERE key = 'shop.name'").pluck().get()).toBe('新店')
  db.close()

  expect(applyPendingRestore(currentDb)).toBe(true)
  db = openDb(currentDb, migrations)
  verifyHistory(db)
  expect(db.prepare("SELECT value FROM app_setting WHERE key = 'license.install_id'").pluck().get()).toBe('this-device')
  expect(db.prepare("SELECT value FROM app_setting WHERE key = 'shop.name'").pluck().get()).toBe('老店')
  expect(db.prepare("SELECT operator FROM platform_log WHERE action = 'restore'").pluck().get()).toBe(owner.username)
  expect(service.listBackups(join(profile, 'backups')).some(({ name }) => name.includes('before-restore'))).toBe(true)
})
