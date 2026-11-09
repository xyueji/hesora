import { describe, it, expect } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { runMigrations } from '../../src/main/db/migrate'
import type Database from 'better-sqlite3'

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(r => r.name)
}

describe('v1.3 host migrations 080-083', () => {
  it('sets user_version to 83 after migrations', () => {
    const db = openMemDb()
    expect(db.pragma('user_version', { simple: true })).toBe(83)
  })
  it('creates command_results with device index', () => {
    const db = openMemDb()
    expect(tableNames(db)).toContain('command_results')
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[]).map(r => r.name)
    expect(idx).toContain('idx_command_results_device')
  })
  it('creates host_devices', () => {
    const db = openMemDb()
    expect(tableNames(db)).toContain('host_devices')
    const cols = (db.prepare('PRAGMA table_info(host_devices)').all() as { name: string }[]).map(c => c.name)
    expect(cols).toEqual(['device_id', 'device_name', 'secret_hash', 'paired_at', 'revoked_at', 'last_seen_at'])
  })
  it('creates host_sessions with device index', () => {
    const db = openMemDb()
    expect(tableNames(db)).toContain('host_sessions')
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[]).map(r => r.name)
    expect(idx).toContain('idx_host_sessions_device')
  })
  it('creates backup_v2 with done default', () => {
    const db = openMemDb()
    expect(tableNames(db)).toContain('backup_v2')
    db.prepare(`INSERT INTO backup_v2 (backup_id, path, meta_json, created_at) VALUES ('b1', 'p', '{}', '2026-01-01')`).run()
    const row = db.prepare(`SELECT state FROM backup_v2 WHERE backup_id='b1'`).get() as { state: string }
    expect(row.state).toBe('done')
  })
  it('is idempotent: reopening migrations on migrated db does not throw', () => {
    const db = openMemDb()
    expect(() => {
      // runMigrations again on the same db (simulates second open)
      runMigrations(db)
    }).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(83)
  })
})
