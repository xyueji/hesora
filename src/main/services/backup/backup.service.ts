import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, lstatSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { BizError } from '../../../shared/result'
import { createAuditService } from '../audit/audit.service'

export interface BackupInfo {
  name: string
  mtime: number
  size: number
}

function timestamp(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function vacuumInto(db: Database.Database, destination: string): void {
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    db.prepare('VACUUM INTO ?').run(temporary)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function applyPendingRestore(currentDbPath: string): boolean {
  const pending = `${currentDbPath}.restore`
  if (!existsSync(pending)) return false
  // The previous process closes the database before restarting. Refuse to
  // overwrite a database with outstanding journal files.
  if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(currentDbPath + suffix))) {
    throw new BizError('VALIDATION', '数据库存在未处理的事务文件，暂缓恢复')
  }
  renameSync(pending, currentDbPath)
  return true
}

function validateRestoreSchema(candidate: Database.Database, live: Database.Database): void {
  const tables = live.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[]
  const columnSql = 'SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid'
  const currentColumns = live.prepare(columnSql)
  const candidateColumns = candidate.prepare(columnSql)
  for (const table of tables) {
    if (JSON.stringify(candidateColumns.all(table)) !== JSON.stringify(currentColumns.all(table))) {
      throw new Error('incompatible snapshot schema')
    }
  }
}

export function createBackupService(
  db: Database.Database,
  dbFilePath: string,
  migrateRestore?: (db: Database.Database) => void
) {
  function backupTo(dirPath: string, suffix = 'backup'): string {
    mkdirSync(dirPath, { recursive: true })
    const base = basename(dbFilePath, '.db')
    const target = join(dirPath, `${base}-${suffix}-${timestamp()}-${randomUUID()}.db`)
    vacuumInto(db, target)
    return target
  }

  function listBackups(dirPath: string): BackupInfo[] {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
        .map(({ name }) => {
          const st = lstatSync(join(dirPath, name))
          return { name, mtime: st.mtimeMs, size: st.size }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }

  function dailyBackup(dirPath: string): void {
    const today = timestamp().slice(0, 8)
    const pattern = /^(?:hesora-inventory|zhjs-erp)-(?:daily|backup)-(\d{8}-\d{6})/
    const daily = () => listBackups(dirPath)
      .map((entry) => ({ ...entry, date: pattern.exec(entry.name)?.[1] }))
      .filter((entry) => entry.date !== undefined)
      .sort((a, b) => b.date!.localeCompare(a.date!))
    if (!daily().some(({ name }) => name.includes(`-daily-${today}-`))) backupTo(dirPath, 'daily')
    for (const { name } of daily().slice(30)) rmSync(join(dirPath, name), { force: true })
  }

  function restoreFrom(backupPath: string, currentDbPath: string, safetyDir = dirname(currentDbPath), operator?: string,
    remote?: { sequence: number; checksum: string; fingerprint: string }): void {
    if (!existsSync(backupPath)) throw new BizError('NOT_FOUND', '备份文件不存在')
    if (resolve(backupPath) === resolve(currentDbPath)) throw new BizError('VALIDATION', '请选择独立的备份文件')
    const pending = `${currentDbPath}.restore`
    const staged = `${pending}.${randomUUID()}.tmp`
    const originalVersion = Number(db.pragma('user_version', { simple: true }))
    try {
      const source = new Database(backupPath, { readonly: true, fileMustExist: true })
      try {
        source.pragma('trusted_schema = OFF')
        const version = Number(source.pragma('user_version', { simple: true }))
        if (version < 1 || version > originalVersion ||
            source.pragma('quick_check', { simple: true }) !== 'ok') {
          throw new Error('incompatible snapshot')
        }
        vacuumInto(source, staged)
      } finally {
        source.close()
      }
      const copy = new Database(staged, { fileMustExist: true })
      try {
        copy.pragma('trusted_schema = OFF')
        copy.pragma('foreign_keys = ON')
        migrateRestore?.(copy)
        if (Number(copy.pragma('user_version', { simple: true })) !== originalVersion) {
          throw new Error('snapshot migrations incomplete')
        }
        validateRestoreSchema(copy, db)
        const settings = db.prepare("SELECT key, value FROM app_setting WHERE key LIKE 'license.%' OR key LIKE 'sync.%'").all() as { key: string; value: string }[]
        copy.transaction(() => {

          copy.prepare("DELETE FROM app_setting WHERE key LIKE 'license.%' OR key LIKE 'sync.%'").run()
          const write = copy.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?)')
          for (const { key, value } of settings) write.run(key, value)
          if (remote) {
            const localSequence = Number(settings.find(({ key }) => key === "sync.sequence")?.value) || 0
            const replace = copy.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)')
            replace.run('sync.sequence', String(Math.max(localSequence, remote.sequence)))
            replace.run('sync.snapshot_sha256', remote.checksum)
            replace.run('sync.business_fingerprint', remote.fingerprint)
          }
          createAuditService(copy).record('restore', operator, basename(backupPath))
        })()
      } finally {
        copy.close()
      }
      backupTo(safetyDir, 'before-restore')
      renameSync(staged, pending)
    } catch {
      throw new BizError('VALIDATION', '备份文件无效，或无法写入恢复暂存文件')
    } finally {
      rmSync(staged, { force: true })
    }
  }

  return { backupTo, listBackups, dailyBackup, restoreFrom }
}

export type BackupService = ReturnType<typeof createBackupService>
