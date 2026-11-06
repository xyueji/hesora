import { mkdirSync, copyFileSync, statSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export interface BackupInfo {
  name: string
  mtime: number
  size: number
}

function timestamp(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function createBackupService(db: Database, dbFilePath: string) {
  return {
    /** WAL checkpoint then copy the db file into dirPath; returns the backup file path. */
    backupTo(dirPath: string, suffix = ''): string {
      db.pragma('wal_checkpoint(TRUNCATE)')
      mkdirSync(dirPath, { recursive: true })
      const base = basename(dbFilePath, '.db')
      const name = suffix
        ? `${base}-${suffix}-${timestamp()}.db`
        : `${base.replace(/-backup(-before-restore)?$/, '') || 'zhjs-erp'}-backup-${timestamp()}.db`
      const target = join(dirPath, name)
      copyFileSync(dbFilePath, target)
      return target
    },

    listBackups(dirPath: string): BackupInfo[] {
      let names: string[]
      try {
        names = readdirSync(dirPath)
      } catch {
        return []
      }
      const out: BackupInfo[] = []
      for (const name of names) {
        if (!name.endsWith('.db')) continue
        const full = join(dirPath, name)
        const st = statSync(full)
        if (!st.isFile()) continue
        out.push({ name, mtime: st.mtimeMs, size: st.size })
      }
      out.sort((a, b) => b.mtime - a.mtime)
      return out
    },

    /**
     * Copy backupPath over currentDbPath. Safety: backs up the current db first
     * with a `before-restore` suffix. Note: the running process keeps its open db
     * handle — the caller (Electron layer) should relaunch the app after restore.
     */
    restoreFrom(backupPath: string, currentDbPath: string): void {
      try {
        statSync(backupPath)
      } catch {
        throw new BizError('NOT_FOUND', `备份文件不存在：${backupPath}`)
      }
      const dir = join(currentDbPath, '..')
      this.backupTo(dir, 'before-restore')
      copyFileSync(backupPath, currentDbPath)
    }
  }
}

export type BackupService = ReturnType<typeof createBackupService>
