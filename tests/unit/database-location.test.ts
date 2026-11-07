import { afterEach, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDatabasePath } from '../../src/main/db/location'
import { runMigrations } from '../../src/main/db/migrate'

const directories: string[] = []
function tempDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'hesora-db-test-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('moves a legacy account, including a recovery journal, to the new database name', () => {
  const dir = tempDirectory()
  const legacy = join(dir, 'zhjs-erp.db')
  const db = new Database(legacy)
  db.pragma('journal_mode = WAL')
  db.exec("CREATE TABLE account (name TEXT); INSERT INTO account VALUES ('Existing account')")
  db.close()

  const file = resolveDatabasePath(dir)
  expect(file).toBe(join(dir, 'hesora-inventory.db'))
  expect(existsSync(legacy)).toBe(false)
  const upgraded = new Database(file, { readonly: true })
  try {
    expect(upgraded.prepare('SELECT name FROM account').pluck().get()).toBe('Existing account')
    expect(resolveDatabasePath(dir)).toBe(file)
  } finally {
    upgraded.close()
  }
})

it('refuses to replace either account when both database names exist', () => {
  const dir = tempDirectory()
  for (const filename of ['zhjs-erp.db', 'hesora-inventory.db']) new Database(join(dir, filename)).close()
  expect(() => resolveDatabasePath(dir)).toThrow(/两份账套/)
  expect(existsSync(join(dir, 'zhjs-erp.db'))).toBe(true)
  expect(existsSync(join(dir, 'hesora-inventory.db'))).toBe(true)
})

it('rolls back both schema changes and migration version on failure and supports retry', () => {
  const dir = tempDirectory()
  const script = join(dir, '001_test.sql')
  const db = new Database(':memory:')
  try {
    writeFileSync(script, 'CREATE TABLE good (id INTEGER); SELECT * FROM missing;')
    expect(() => runMigrations(db, dir)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'good'").get()).toBeUndefined()
    writeFileSync(script, 'CREATE TABLE good (id INTEGER);')
    runMigrations(db, dir)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    db.pragma('user_version = 2')
    expect(() => runMigrations(db, dir)).toThrow(/更高版本/)
  } finally {
    db.close()
  }
})

it('rolls back all pending migrations when a later script fails', () => {
  const dir = tempDirectory()
  const db = new Database(':memory:')
  try {
    writeFileSync(join(dir, '001_base.sql'), 'CREATE TABLE initial (id INTEGER);')
    runMigrations(db, dir)
    writeFileSync(join(dir, '002_valid.sql'), 'INSERT INTO initial VALUES (1); CREATE TABLE intermediate (id INTEGER);')
    writeFileSync(join(dir, '003_invalid.sql'), 'SELECT * FROM missing;')

    expect(() => runMigrations(db, dir)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare('SELECT * FROM initial').all()).toEqual([])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'intermediate'").get()).toBeUndefined()
  } finally {
    db.close()
  }
})
