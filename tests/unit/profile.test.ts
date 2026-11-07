import { afterEach, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProfilePath } from '../../src/main/db/profile'

const directories: string[] = []
function tempDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'hesora-profile-test-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('moves the legacy profile directory to the new brand folder', () => {
  const appData = tempDirectory()
  const legacy = join(appData, 'zhjs-erp')
  mkdirSync(legacy)
  const db = new Database(join(legacy, 'zhjs-erp.db'))
  db.pragma('journal_mode = WAL')
  db.exec("CREATE TABLE account (name TEXT); INSERT INTO account VALUES ('旧账套')")
  db.close()
  writeFileSync(join(legacy, 'hesora-inventory-backup-20240101-000000.db'), 'backup')

  const profile = resolveProfilePath(appData)
  expect(profile).toBe(join(appData, 'hesora-inventory'))
  expect(existsSync(legacy)).toBe(false)
  expect(existsSync(join(profile, 'hesora-inventory-backup-20240101-000000.db'))).toBe(true)

  const upgraded = new Database(join(profile, 'zhjs-erp.db'), { readonly: true })
  try {
    expect(upgraded.prepare('SELECT name FROM account').pluck().get()).toBe('旧账套')
  } finally {
    upgraded.close()
  }
})

it('keeps the new folder when both folders already exist', () => {
  const appData = tempDirectory()
  mkdirSync(join(appData, 'zhjs-erp'))
  mkdirSync(join(appData, 'hesora-inventory'))
  const profile = resolveProfilePath(appData)
  expect(profile).toBe(join(appData, 'hesora-inventory'))
  expect(existsSync(join(appData, 'zhjs-erp'))).toBe(true)
})

it('returns the new folder when no legacy profile exists', () => {
  const appData = tempDirectory()
  expect(resolveProfilePath(appData)).toBe(join(appData, 'hesora-inventory'))
})
