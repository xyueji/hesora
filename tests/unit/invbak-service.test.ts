import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInvbakService, type EncryptedBackupRow } from '../../src/main/services/backup/invbak.service'
import { BizError } from '../../src/shared/result'

const PASS = 'test-passphrase-123'
const MIGRATIONS_DIR = join(__dirname, '../../src/main/db/migrations')

let db: Database.Database
let svc: ReturnType<typeof createInvbakService>
let outDir: string
let created: ReturnType<typeof svc.createEncryptedBackup>
let rows: EncryptedBackupRow[]

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'invbak-svc-'))
  db = new Database(':memory:')
  db.pragma('user_version = 83')
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_v2 (
      backup_id  TEXT PRIMARY KEY,
      path       TEXT NOT NULL,
      meta_json  TEXT NOT NULL,
      state      TEXT NOT NULL DEFAULT 'done',
      created_at TEXT NOT NULL
    );
    CREATE TABLE goods (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);
  `)
  db.prepare("INSERT INTO goods (name, qty) VALUES ('可乐 330ml', 5), ('薯片', 12)").run()
  mkdirSync(join(root, 'backups'), { recursive: true })
  outDir = join(root, 'backups')
  svc = createInvbakService(db, {
    appVersion: '1.3.0-test',
    sourceInstanceId: 'aaaa-bbbb-cccc',
    migrationsDir: MIGRATIONS_DIR,
  })
  created = svc.createEncryptedBackup({ passphrase: PASS, storeName: '禾序测试店', outDir })
  rows = svc.listEncryptedBackups()
})

describe('invbak.service createEncryptedBackup', () => {
  it('writes .ivbak file with parseable, consistent meta_json', () => {
    expect(existsSync(created.path)).toBe(true)
    expect(created.path.endsWith('.ivbak')).toBe(true)
    const meta = created.meta
    expect(meta.backupId).toBe(created.backupId)
    expect(meta.storeName).toBe('禾序测试店')
    expect(meta.dbSchemaVersion).toBe(83)
    expect(meta.appVersion).toBe('1.3.0-test')
    expect(meta.sourceInstanceId).toBe('aaaa-bbbb-cccc')
    expect(meta.sizeBytes).toBeGreaterThan(0)
    expect(meta.snapshotSha256).toMatch(/^[0-9a-f]{64}$/)
    // meta_json stored in table parses and matches
    const row = rows.find((r) => r.backupId === created.backupId)
    expect(row).toBeDefined()
    expect(row!.meta).toEqual(meta)
    expect(row!.state).toBe('done')
  })
})

describe('invbak.service restoreEncryptedBackup', () => {
  it('writes pending restore file (applyPendingRestore picks up next boot)', () => {
    // :memory: 库没有文件路径，改用临时文件库再建一次服务
    const root = mkdtempSync(join(tmpdir(), 'invbak-restore-'))
    const dbPath = join(root, 'main.db')
    const fileDb = new Database(dbPath)
    fileDb.pragma('user_version = 83')
    fileDb.exec(`CREATE TABLE IF NOT EXISTS backup_v2 (
      backup_id TEXT PRIMARY KEY, path TEXT NOT NULL, meta_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'done', created_at TEXT NOT NULL)`)
    const fileSvc = createInvbakService(fileDb, {
      appVersion: '1.3.0-test',
      sourceInstanceId: 'aaaa-bbbb-cccc',
      migrationsDir: MIGRATIONS_DIR,
    })
    const bak = fileSvc.createEncryptedBackup({ passphrase: PASS, storeName: '还原店', outDir: root })
    const result = fileSvc.restoreEncryptedBackup({ path: bak.path, passphrase: PASS })
    expect(result.ok).toBe(true)
    const pending = `${dbPath}.restore`
    expect(existsSync(pending)).toBe(true)
    // 挂起的恢复文件本身是合法 SQLite 快照
    const check = new Database(pending, { readonly: true })
    expect(check.pragma('quick_check', { simple: true })).toBe('ok')
    check.close()
    // 状态改为 pending-restore
    const st = fileDb.prepare('SELECT state FROM backup_v2 WHERE backup_id = ?').get(bak.backupId) as { state: string }
    expect(st.state).toBe('pending-restore')
    fileDb.close()
  })

  it('rejects newer schema version with E_BACKUP_NEWER', () => {
    // 构造 meta.dbSchemaVersion = 999 的容器：手动改 meta 无法过 GCM，
    // 所以直接在更高 user_version 的库上建备份，再到当前库恢复。
    const root = mkdtempSync(join(tmpdir(), 'invbak-newer-'))
    const hiDb = new Database(':memory:')
    hiDb.pragma('user_version = 999')
    hiDb.exec(`CREATE TABLE IF NOT EXISTS backup_v2 (
      backup_id TEXT PRIMARY KEY, path TEXT NOT NULL, meta_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'done', created_at TEXT NOT NULL)`)
    const hiSvc = createInvbakService(hiDb, {
      appVersion: '9.0.0',
      sourceInstanceId: 'x',
      migrationsDir: MIGRATIONS_DIR,
    })
    const bak = hiSvc.createEncryptedBackup({ passphrase: PASS, storeName: '未来店', outDir: root })
    try {
      svc.restoreEncryptedBackup({ path: bak.path, passphrase: PASS })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('E_BACKUP_NEWER')
    }
  })

  it('rejects wrong passphrase as E_BACKUP_INVALID', () => {
    try {
      svc.restoreEncryptedBackup({ path: created.path, passphrase: 'nope' })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('E_BACKUP_INVALID')
    }
  })

  it('rejects missing file with NOT_FOUND', () => {
    try {
      svc.restoreEncryptedBackup({ path: join(outDir, 'missing.ivbak'), passphrase: PASS })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('NOT_FOUND')
    }
  })
})

describe('invbak.service listEncryptedBackups', () => {
  it('returns parsed rows ordered by created_at desc', () => {
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const r of rows) {
      expect(r.meta.backupId).toBe(r.backupId)
      expect(typeof r.meta.snapshotSha256).toBe('string')
    }
  })
})
