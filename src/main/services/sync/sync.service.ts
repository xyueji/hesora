import { writeFile, readFile, copyFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { createBackupService, type BackupService } from '../backup/backup.service'
import { webdavPut, webdavGet, davJoin } from './webdav'

export type SyncType = '' | 'local' | 'webdav'

export interface SyncWebdavConfig {
  url: string
  username: string
  password: string
}

export interface SyncConfig {
  type: SyncType
  webdav: SyncWebdavConfig
  local: { dir: string }
  last_time: string
}

export interface SyncNowResult {
  ok: boolean
  detail: string
}

const KEY_PREFIX = 'sync.'
const DB_NAME = 'zhjs-erp.db'

export function createSyncService(
  db: Database,
  opts: {
    getDbFilePath: () => string
    /** Where sync-time local backups are written (usually userData/backups). */
    backupsDir: string
    backupService?: BackupService
  }
) {
  const backupService = opts.backupService ?? createBackupService(db, opts.getDbFilePath())

  function readKey(key: string): string {
    const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : ''
  }

  function writeKey(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(key, value)
  }

  function requireTarget(cfg: SyncConfig): void {
    if (cfg.type === '' || (cfg.type === 'local' && !cfg.local.dir) || (cfg.type === 'webdav' && !cfg.webdav.url)) {
      throw new BizError('VALIDATION', '请先配置同步目标')
    }
  }

  function markDone(): SyncNowResult {
    const now = new Date().toISOString()
    writeKey(`${KEY_PREFIX}last_time`, now)
    return { ok: true, detail: now }
  }

  return {
    backupService,

    listLocalBackups() {
      return backupService.listBackups(opts.backupsDir)
    },

    getConfig(): SyncConfig {
      return {
        type: (readKey(`${KEY_PREFIX}type`) || '') as SyncType,
        webdav: {
          url: readKey(`${KEY_PREFIX}webdav.url`),
          username: readKey(`${KEY_PREFIX}webdav.username`),
          password: readKey(`${KEY_PREFIX}webdav.password`)
        },
        local: { dir: readKey(`${KEY_PREFIX}local.dir`) },
        last_time: readKey(`${KEY_PREFIX}last_time`)
      }
    },

    saveConfig(partial: Partial<SyncConfig>): void {
      if (partial.type !== undefined) writeKey(`${KEY_PREFIX}type`, partial.type)
      if (partial.webdav) {
        if (partial.webdav.url !== undefined) writeKey(`${KEY_PREFIX}webdav.url`, partial.webdav.url)
        if (partial.webdav.username !== undefined)
          writeKey(`${KEY_PREFIX}webdav.username`, partial.webdav.username)
        if (partial.webdav.password !== undefined)
          writeKey(`${KEY_PREFIX}webdav.password`, partial.webdav.password)
      }
      if (partial.local && partial.local.dir !== undefined)
        writeKey(`${KEY_PREFIX}local.dir`, partial.local.dir)
    },

    /**
     * Always back up locally first, then push the db file to the configured
     * target. Sets sync.last_time on success. Throws BizError when unconfigured
     * or the upload fails.
     */
    async syncNow(): Promise<SyncNowResult> {
      const cfg = this.getConfig()
      requireTarget(cfg)
      // 云盘同步前必做本地备份
      backupService.backupTo(opts.backupsDir)
      const dbFile = opts.getDbFilePath()
      if (cfg.type === 'local') {
        try {
          await mkdir(cfg.local.dir, { recursive: true })
          await copyFile(dbFile, join(cfg.local.dir, DB_NAME))
        } catch (e) {
          throw new BizError('SYNC_FAIL', `同步失败：无法写入本地目录（${String((e as Error)?.message ?? e)}）`)
        }
      } else {
        const url = davJoin(cfg.webdav.url, DB_NAME)
        let body: Buffer
        try {
          body = await readFile(dbFile)
        } catch (e) {
          throw new BizError('SYNC_FAIL', `同步失败：读取数据库文件失败（${String((e as Error)?.message ?? e)}）`)
        }
        const res = await webdavPut(url, body, cfg.webdav.username, cfg.webdav.password)
        if (!res.ok) {
          throw new BizError('SYNC_FAIL', `同步失败：服务器返回状态 ${res.status}`)
        }
      }
      return markDone()
    },

    /**
     * Fetch the remote db into a temp file and return its path. The caller then
     * confirms and runs backupService.restoreFrom(tempPath, currentDbPath), and
     * should relaunch the app afterwards.
     */
    async downloadFrom(): Promise<string> {
      const cfg = this.getConfig()
      requireTarget(cfg)
      const temp = join(tmpdir(), `zhjs-erp-restore-${Date.now()}.db`)
      if (cfg.type === 'local') {
        await copyFile(join(cfg.local.dir, DB_NAME), temp)
        return temp
      }
      const url = davJoin(cfg.webdav.url, DB_NAME)
      const res = await webdavGet(url, cfg.webdav.username, cfg.webdav.password)
      if (!res.ok) {
        throw new BizError('SYNC_FAIL', `下载失败：服务器返回状态 ${res.status}`)
      }
      await writeFile(temp, Buffer.from(await res.arrayBuffer()))
      return temp
    }
  }
}

export type SyncService = ReturnType<typeof createSyncService>
