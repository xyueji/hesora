import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as backup from '../../src/main/services/backup/backup.service'
import { runMigrations } from '../../src/main/db/migrate'

let dir: string
let dbFile: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hesora-backup-'))
  dbFile = join(dir, 'hesora-inventory.db')
  db = new Database(dbFile)
  runMigrations(db, join(process.cwd(), 'src/main/db/migrations'))
  db.pragma('journal_mode = WAL')
  db.prepare("INSERT INTO app_setting VALUES ('example', 'v1')").run()
})

afterEach(() => {
  if (db.open) db.close()
  rmSync(dir, { recursive: true, force: true })
})

function value(db: Database.Database, key = 'example') {
  return db.prepare('SELECT value FROM app_setting WHERE key = ?').pluck().get(key)
}

describe('backup.service', () => {
  it('takes a standalone snapshot containing committed WAL writes', () => {
    const svc = backup.createBackupService(db, dbFile)
    const path = svc.backupTo(dir)
    const snapshot = new Database(path, { readonly: true })
    try {
      expect(value(snapshot)).toBe('v1')
    } finally {
      snapshot.close()
    }
  })

  it('keeps separate backups within the same second', () => {
    const svc = backup.createBackupService(db, dbFile)
    const first = svc.backupTo(dir)
    expect(svc.backupTo(dir)).not.toBe(first)
  })

  it('rejects invalid restore sources before changing live data', () => {
    const svc = backup.createBackupService(db, dbFile)
    const invalid = join(dir, 'invalid.db')
    writeFileSync(invalid, 'not a database')
    expect(() => svc.restoreFrom(invalid, dbFile)).toThrow(/备份文件无效/)
    expect(value(db)).toBe('v1')
  })

  it('stages a restore and applies it after closing the live database', () => {
    const svc = backup.createBackupService(db, dbFile)
    const path = svc.backupTo(dir)
    db.prepare("UPDATE app_setting SET value = 'v2' WHERE key = 'example'").run()
    db.prepare("INSERT INTO app_setting VALUES ('license.install_id', 'local-device')").run()
    svc.restoreFrom(path, dbFile)
    expect(value(db)).toBe('v2')
    db.close()

    expect(backup.applyPendingRestore(dbFile)).toBe(true)
    db = new Database(dbFile)
    expect(value(db)).toBe('v1')
    expect(value(db, 'license.install_id')).toBe('local-device')
    expect(svc.listBackups(dir).some((entry) => entry.name.includes('before-restore'))).toBe(true)
    expect(backup.applyPendingRestore(dbFile)).toBe(false)
  })
})

it('keeps one automatic backup per day and retains the latest 30', () => {
  const service = backup.createBackupService(db, dbFile)
  const backupsDir = join(dir, 'backups')
  service.dailyBackup(backupsDir)
  service.dailyBackup(backupsDir)
  expect(service.listBackups(backupsDir)).toHaveLength(1)
  for (let i = 1; i <= 31; i++) {
    const name = `zhjs-erp-backup-202401${String(i).padStart(2, '0')}-000000.db`
    writeFileSync(join(backupsDir, name), 'legacy')
  }
  service.dailyBackup(backupsDir)
  expect(service.listBackups(backupsDir)).toHaveLength(30)
  expect(service.listBackups(backupsDir).some(({ name }) => name.includes('-daily-'))).toBe(true)
})

it('refuses a newer database and leaves the live profile bootable', () => {
  const service = backup.createBackupService(db, dbFile)
  const futureFile = service.backupTo(dir)
  const future = new Database(futureFile)
  const originalVersion = Number(db.pragma('user_version', { simple: true }))
  future.pragma(`user_version = ${originalVersion + 1}`)
  future.close()

  expect(() => service.restoreFrom(futureFile, dbFile)).toThrow(/备份文件无效/)
  expect(backup.applyPendingRestore(dbFile)).toBe(false)
  db.close()
  db = new Database(dbFile)
  expect(value(db)).toBe('v1')
})

it('rejects a valid SQLite file that only imitates the core application tables', () => {
  const service = backup.createBackupService(db, dbFile)
  const badPath = join(dir, 'impostor.db')
  const impostor = new Database(badPath)
  try {
    impostor.pragma(`user_version = ${db.pragma('user_version', { simple: true })}`)
    impostor.exec(`
      CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE product (id INTEGER PRIMARY KEY);
      CREATE TABLE inventory (id INTEGER PRIMARY KEY);
      CREATE TABLE warehouse (id INTEGER PRIMARY KEY);
    `)
  } finally {
    impostor.close()
  }
  expect(() => service.restoreFrom(badPath, dbFile)).toThrow(/备份文件无效/)
  expect(backup.applyPendingRestore(dbFile)).toBe(false)
  expect(value(db)).toBe('v1')
})
