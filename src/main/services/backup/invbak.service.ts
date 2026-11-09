import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BizError, ok, type Result } from '../../../shared/result'
import { sha256 } from '@noble/hashes/sha2.js'
import { createInvbak, readInvbak, type InvbakMeta } from '../../backup/invbak'

// db 编排层：不 import electron —— appVersion / sourceInstanceId / migrationsDir
// 由调用方（未来 IPC 层）注入，测试直接传固定值。
export interface InvbakServiceDeps {
  appVersion: string
  sourceInstanceId: string
  migrationsDir: string
}

export interface EncryptedBackupRow {
  backupId: string
  path: string
  state: string
  createdAt: string
  meta: InvbakMeta
}

function currentSchemaVersion(migrationsDir: string): number {
  // 迁移文件以 NNN_name.sql 命名，最大 NNN 即当前 schema 版本。
  let files: string[] = []
  try {
    files = readdirSync(migrationsDir)
  } catch {
    files = []
  }
  let max = 0
  for (const name of files) {
    const m = /^(\d{3})_/.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

export function createInvbakService(db: Database.Database, deps: InvbakServiceDeps) {
  function createEncryptedBackup(args: {
    passphrase: string
    storeName: string
    outDir: string
    migrationsDir?: string
    snapshotBytes?: Uint8Array
    dbSchemaVersion?: number
  }): { backupId: string; path: string; meta: InvbakMeta } {
    const migrationsDir = args.migrationsDir ?? deps.migrationsDir
    const backupId = randomUUID()
    mkdirSync(args.outDir, { recursive: true })
    const target = join(args.outDir, `${backupId}.ivbak`)
    const tmpSnapshot = `${target}.${randomUUID()}.snapshot.tmp`

    let snapshot: Uint8Array
    let schemaVersion: number
    if (args.snapshotBytes) {
      snapshot = args.snapshotBytes
      schemaVersion = args.dbSchemaVersion ?? 0
    } else {
      try {
        db.prepare('VACUUM INTO ?').run(tmpSnapshot)
        snapshot = new Uint8Array(readFileSync(tmpSnapshot))
      } finally {
        rmSync(tmpSnapshot, { force: true })
      }
      schemaVersion = args.dbSchemaVersion ?? Number(db.pragma('user_version', { simple: true }))
    }
    if (schemaVersion < 1) schemaVersion = currentSchemaVersion(migrationsDir)

    // M2：从这一步起 target 可能已写盘，任何失败都要清掉孤儿 .ivbak。
    try {
      const bytes = createInvbak(snapshot, {
        passphrase: args.passphrase,
        meta: {
          backupId,
          storeName: args.storeName,
          createdAtUtc: new Date().toISOString(),
          dbSchemaVersion: schemaVersion,
          appVersion: deps.appVersion,
          sourceInstanceId: deps.sourceInstanceId,
          // 容器内会重算为含 schema 绑定的指纹；此处值仅为占位，会被覆盖。
          snapshotSha256: Buffer.from(sha256(snapshot)).toString('hex'),
          sizeBytes: snapshot.length,
        },
      })
      writeFileSync(target, bytes)
      // 读回一次：既验证容器可解，又拿到规范化的 meta（含 backupId）入库。
      const verified = readInvbak(bytes, { passphrase: args.passphrase })
      db.prepare(
        'INSERT INTO backup_v2 (backup_id, path, meta_json, state, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(backupId, resolve(target), JSON.stringify(verified.meta), 'done', new Date().toISOString())
      return { backupId, path: target, meta: verified.meta }
    } catch (e) {
      rmSync(target, { force: true })
      throw e
    }
  }

  function restoreEncryptedBackup(args: { path: string; passphrase: string }): Result<{ backupId: string; meta: InvbakMeta }> {
    if (!existsSync(args.path)) throw new BizError('NOT_FOUND', '备份文件不存在')
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(args.path))
    } catch {
      throw new BizError('E_BACKUP_INVALID', '备份文件无法读取')
    }
    let meta: InvbakMeta
    let snapshot: Uint8Array
    try {
      const parsed = readInvbak(bytes, { passphrase: args.passphrase })
      meta = parsed.meta
      snapshot = parsed.snapshotBytes
    } catch (e) {
      if (e instanceof BizError) throw new BizError('E_BACKUP_INVALID', `备份容器无效：${e.message}`)
      throw e
    }
    const currentVersion = Number(db.pragma('user_version', { simple: true }))
    if (meta.dbSchemaVersion > currentVersion) {
      throw new BizError('E_BACKUP_NEWER', `备份 schema 版本 (${meta.dbSchemaVersion}) 高于当前 (${currentVersion})，请先升级软件`)
    }
    // 复用现有 applyPendingRestore 机制：把快照写到 <dbPath>.restore，
    // 下次启动时由 applyPendingRestore 替换主库。dbPath 通过 PRAGMA database_list 取。
    const row = db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]
    const mainFile = row.find((r) => r.name === 'main')?.file ?? ''
    if (!mainFile) throw new BizError('E_BACKUP_INVALID', '无法确定主数据库路径')
    const pending = `${mainFile}.restore`
    const staged = `${pending}.${randomUUID()}.tmp`
    try {
      writeFileSync(staged, snapshot)
      rmSync(pending, { force: true })
      renameSync(staged, pending)
    } finally {
      rmSync(staged, { force: true })
    }
    db.prepare("UPDATE backup_v2 SET state = 'pending-restore' WHERE backup_id = ?").run(meta.backupId)
    return ok({ backupId: meta.backupId, meta })
  }

  function listEncryptedBackups(): EncryptedBackupRow[] {
    const rows = db.prepare('SELECT backup_id, path, meta_json, state, created_at FROM backup_v2 ORDER BY created_at DESC').all() as {
      backup_id: string
      path: string
      meta_json: string
      state: string
      created_at: string
    }[]
    return rows.map((r) => ({
      backupId: r.backup_id,
      path: r.path,
      state: r.state,
      createdAt: r.created_at,
      meta: JSON.parse(r.meta_json) as InvbakMeta,
    }))
  }

  return { createEncryptedBackup, restoreEncryptedBackup, listEncryptedBackups }
}

export type InvbakService = ReturnType<typeof createInvbakService>
