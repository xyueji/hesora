import { createHash, randomUUID } from 'node:crypto'
import { writeFile, readFile, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync, gunzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import { createBackupService, type BackupService } from '../backup/backup.service'
import { webdavPut, webdavGet, davJoin } from './webdav'

export type SyncType = '' | 'local' | 'webdav' | 'both'
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
  intervalHours?: number
  lastError?: string
  remoteSequence?: number
}

export interface SyncNowResult {
  ok: boolean
  detail: string
}

interface SnapshotManifest {
  version: 1
  timestamp: string
  deviceId: string
  sequence: number
  sha256: string
}

const SNAPSHOT_NAME = 'hesora-inventory.zjsnap'
const LEGACY_NAMES = ['hesora-inventory.db', 'zhjs-erp.db']
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024

function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function decodeSnapshot(body: Buffer): { manifest: SnapshotManifest; database: Buffer } {
  try {
    const raw = gunzipSync(body, { maxOutputLength: MAX_SNAPSHOT_BYTES })
    const separator = raw.indexOf(10)
    if (separator < 1 || separator > 4096) throw new Error('invalid manifest')
    const manifest = JSON.parse(raw.subarray(0, separator).toString('utf8')) as SnapshotManifest
    const database = raw.subarray(separator + 1)
    if (manifest.version !== 1 || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1 ||
        typeof manifest.deviceId !== 'string' || !Number.isFinite(Date.parse(manifest.timestamp)) ||
        !database.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) || manifest.sha256 !== hash(database)) {
      throw new Error('invalid snapshot')
    }
    return { manifest, database }
  } catch {
    throw new BizError('SYNC_FAIL', '云盘快照损坏或版本不受支持')
  }
}

export function createSyncService(
  db: Database.Database,
  opts: { getDbFilePath: () => string; backupsDir: string; backupService?: BackupService }
) {
  const backupService = opts.backupService ?? createBackupService(db, opts.getDbFilePath())
  let uploading = false
  let remoteSequence = 0
  let lastDownload: { path: string; sequence: number } | undefined

  function readKey(key: string): string {
    const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(`sync.${key}`) as
      | { value: string }
      | undefined
    return row?.value ?? ''
  }

  function writeKey(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(`sync.${key}`, value)
  }

  function sequence(): number {
    const n = Number(readKey('sequence'))
    return Number.isSafeInteger(n) && n >= 0 ? n : 0
  }

  function getConfig(): SyncConfig {
    const intervalHours = Number(readKey('interval_hours'))
    const lastError = readKey('last_error')
    return {
      type: (readKey('type') || '') as SyncType,
      webdav: {
        url: readKey('webdav.url'),
        username: readKey('webdav.username'),
        password: readKey('webdav.password')
      },
      local: { dir: readKey('local.dir') },
      last_time: readKey('last_time'),
      ...(intervalHours ? { intervalHours } : {}),
      ...(lastError ? { lastError } : {}),
      ...(remoteSequence > sequence() ? { remoteSequence } : {})
    }
  }

  const saveConfig = db.transaction((partial: Partial<SyncConfig>) => {
    if (uploading) throw new BizError('SYNC_FAIL', '同步进行中，请稍后保存配置')
    if (partial.type !== undefined) {
      if (!['', 'local', 'webdav', 'both'].includes(partial.type)) throw new BizError('VALIDATION', '同步方式无效')
      writeKey('type', partial.type)
    }
    if (partial.webdav) {
      const { url, username, password } = partial.webdav
      if (url !== undefined) {
        if (url) {
          let parsed: URL
          try { parsed = new URL(url) } catch { throw new BizError('VALIDATION', 'WebDAV 地址无效') }
          if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
              parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new BizError('VALIDATION', '请填写不含账号、密码或查询参数的 WebDAV 目录地址')
          }
        }
        writeKey('webdav.url', url)
      }
      if (username !== undefined) writeKey('webdav.username', username)
      if (password !== undefined) writeKey('webdav.password', password)
    }
    if (partial.local?.dir !== undefined) writeKey('local.dir', partial.local.dir)
    if (partial.intervalHours !== undefined) {
      const hours = partial.intervalHours
      if (!Number.isInteger(hours) || hours < 0 || hours > 168) throw new BizError('VALIDATION', '自动同步间隔必须是 0 至 168 小时')
      writeKey('interval_hours', String(hours))
    }
    remoteSequence = 0
  })

  function targets(cfg = getConfig()) {
    const types: ('local' | 'webdav')[] = cfg.type === 'both' ? ['local', 'webdav'] :
      cfg.type === 'local' || cfg.type === 'webdav' ? [cfg.type] : []
    if (!types.length || (types.includes('local') && !cfg.local.dir) ||
        (types.includes('webdav') && !cfg.webdav.url)) {
      throw new BizError('VALIDATION', '请先配置同步目标')
    }
    return types.map((type) => ({
      async read(name: string): Promise<Buffer | undefined> {
        if (type === 'local') {
          try {
            return await readFile(join(cfg.local.dir, name))
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
            throw e
          }
        }
        const res = await webdavGet(davJoin(cfg.webdav.url, name), cfg.webdav.username, cfg.webdav.password)
        if (res.status === 404) return undefined
        if (!res.ok) throw new BizError('SYNC_FAIL', `WebDAV 返回状态 ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      },
      async write(data: Buffer): Promise<void> {
        if (type === 'local') {
          const target = join(cfg.local.dir, SNAPSHOT_NAME)
          const pending = `${target}.${randomUUID()}.tmp`
          await mkdir(cfg.local.dir, { recursive: true })
          try {
            await writeFile(pending, data, { flag: 'wx' })
            await rename(pending, target)
          } finally {
            await rm(pending, { force: true })
          }
          return
        }
        const res = await webdavPut(davJoin(cfg.webdav.url, SNAPSHOT_NAME), data, cfg.webdav.username, cfg.webdav.password)
        if (!res.ok) throw new BizError('SYNC_FAIL', `WebDAV 返回状态 ${res.status}`)
      }
    }))
  }

  async function latest(destinations = targets()) {
    const snapshots = await Promise.all(destinations.map(async (target) => {
      const data = await target.read(SNAPSHOT_NAME)
      return data ? decodeSnapshot(data) : undefined
    }))
    const available = snapshots.filter((snapshot) => snapshot !== undefined)
      .sort((a, b) => b.manifest.sequence - a.manifest.sequence)
    const first = available[0]
    if (first && available.some(({ manifest }) => manifest.sequence === first.manifest.sequence && manifest.sha256 !== first.manifest.sha256)) {
      throw new BizError('SYNC_FAIL', '云盘存在相同序号的不同快照，请检查各目标的数据')
    }
    remoteSequence = first?.manifest.sequence ?? 0
    return first
  }

  async function checkRemote(): Promise<number> {
    if (!getConfig().type || uploading) return 0
    await latest()
    return remoteSequence > sequence() ? remoteSequence : 0
  }

  async function syncNow(): Promise<SyncNowResult> {
    if (uploading) throw new BizError('SYNC_FAIL', '同步进行中')
    const destinations = targets()
    uploading = true
    const temporary = join(tmpdir(), `hesora-sync-${randomUUID()}.db`)
    try {
      await latest(destinations)
      if (remoteSequence > sequence()) throw new BizError('SYNC_FAIL', '云盘有更新的快照，请先恢复再上传')
      const backup = backupService.backupTo(opts.backupsDir, 'before-sync')
      await copyFile(backup, temporary)
      const copy = new Database(temporary, { fileMustExist: true })
      try {
        // Secure delete prevents credentials lingering on freed SQLite pages.
        copy.pragma('secure_delete = ON')
        copy.prepare("DELETE FROM app_setting WHERE key LIKE 'sync.%' OR key LIKE 'license.%'").run()
        copy.exec('VACUUM')
      } finally {
        copy.close()
      }
      const database = await readFile(temporary)
      const nextSequence = sequence() + 1
      const timestamp = new Date().toISOString()
      const deviceId = readKey('device_id') || randomUUID()
      const manifest: SnapshotManifest = { version: 1, timestamp, deviceId, sequence: nextSequence, sha256: hash(database) }
      const payload = gzipSync(Buffer.concat([Buffer.from(JSON.stringify(manifest) + '\n'), database]))
      // Reserve the number even if a later target fails after another accepted it.
      db.transaction(() => {
        writeKey('sequence', String(nextSequence))
        writeKey('device_id', deviceId)
      })()
      for (const target of destinations) await target.write(payload)
      writeKey('last_time', timestamp)
      writeKey('last_error', '')
      const local = backupService.listBackups(opts.backupsDir).filter(({ name }) => name.includes('-before-sync-'))
      await Promise.allSettled(local.slice(30).map(({ name }) => rm(join(opts.backupsDir, name), { force: true })))
      return { ok: true, detail: timestamp }
    } catch (e) {
      const lastError = e instanceof BizError ? e.message : '无法读写同步目标或创建本地快照'
      writeKey('last_error', lastError)
      throw new BizError('SYNC_FAIL', `同步失败：${lastError}`)
    } finally {
      uploading = false
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async function downloadFrom(): Promise<string> {
    if (uploading) throw new BizError('SYNC_FAIL', '同步进行中')
    const destinations = targets()
    const snapshot = await latest(destinations)
    let content = snapshot?.database
    if (!content) {
      for (const target of destinations) {
        for (const name of LEGACY_NAMES) {
          content = await target.read(name)
          if (content) break
        }
        if (content) break
      }
    }
    if (!content) throw new BizError('NOT_FOUND', '云盘没有可恢复的备份')
    if (snapshot && snapshot.manifest.sequence < sequence()) throw new BizError('SYNC_FAIL', '云盘快照比本地同步版本旧')
    const path = join(tmpdir(), `hesora-restore-${randomUUID()}.db`)
    await writeFile(path, content, { flag: 'wx' })
    if (lastDownload) await rm(lastDownload.path, { force: true }).catch(() => undefined)
    lastDownload = { path, sequence: snapshot?.manifest.sequence ?? 0 }
    return path
  }

  async function restoreDownloaded(path: string, operator?: string): Promise<void> {
    if (uploading || !lastDownload || resolve(path) !== resolve(lastDownload.path)) {
      throw new BizError('VALIDATION', '请重新选择从云盘恢复')
    }
    const download = lastDownload
    lastDownload = undefined
    try {
      backupService.restoreFrom(download.path, opts.getDbFilePath(), opts.backupsDir, operator, download.sequence)
    } finally {
      await rm(download.path, { force: true }).catch(() => undefined)
    }
  }

  return {
    backupService, getConfig, saveConfig, syncNow, checkRemote, downloadFrom, restoreDownloaded,
    isUploading: () => uploading,
    listLocalBackups: () => backupService.listBackups(opts.backupsDir)
  }
}

export type SyncService = ReturnType<typeof createSyncService>
