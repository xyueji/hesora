import { createHash, randomUUID } from 'node:crypto'
import { writeFile, readFile, copyFile, mkdir, rename, rm, open } from 'node:fs/promises'
import { join } from 'node:path'
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

export interface SyncTargetStatus {
  target: 'local' | 'webdav'
  state: 'empty' | 'available' | 'conflict' | 'error'
  sequence?: number
  timestamp?: string
  detail: string
}

interface SnapshotSummary { products: number; documents: number; contacts: number; fundAccounts: number; lastDocumentDate: string | null }
export interface SyncRestorePreview {
  token: string
  sequence: number
  timestamp: string | null
  source?: 'local' | 'webdav'
  localChanged: boolean
  local: SnapshotSummary
  remote: SnapshotSummary
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
const PREVIEW_VALID_MS = 10 * 60 * 1000

function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function snapshotSummary(db: Database.Database): SnapshotSummary {
  const products = db.prepare('SELECT COUNT(*) FROM product').pluck().get() as number
  const contacts = db.prepare('SELECT (SELECT COUNT(*) FROM customer) + (SELECT COUNT(*) FROM supplier)').pluck().get() as number
  const fundAccounts = db.prepare('SELECT COUNT(*) FROM fund_account').pluck().get() as number
  const hasDocuments = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'doc'").get()
  if (!hasDocuments) return { products, contacts, fundAccounts, documents: 0, lastDocumentDate: null }
  const data = db.prepare("SELECT COUNT(*) AS documents, MAX(date) AS lastDocumentDate FROM doc WHERE status = 'done'")
    .get() as Pick<SnapshotSummary, 'documents' | 'lastDocumentDate'>
  return { products, contacts, fundAccounts, ...data }
}

function businessFingerprint(db: Database.Database): string {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    AND name <> 'platform_log' ORDER BY name`).pluck().all() as string[]
  const digest = createHash('sha256')
  for (const name of tables) {
    const table = '"' + name.replaceAll('"', '""') + '"'
    const where = name === 'app_setting' ? "WHERE key NOT LIKE 'sync.%' AND key NOT LIKE 'license.%'" : ''
    const statement = db.prepare(`SELECT * FROM ${table} ${where}`)
    const order = statement.columns().map((_, i) => i + 1).join(',')
    digest.update(`${name}\n`)
    for (const row of db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${order}`).raw().iterate()) {
      digest.update(`${JSON.stringify(row)}\n`)
    }
  }
  return digest.digest('hex')
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
  let lastDownload: { path: string; manifest?: SnapshotManifest; checksum: string } | undefined
  let activePreview: { token: string; path: string; expiresAt: number; localHash: string; remoteHash: string; localChanged: boolean } | undefined

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
    return types.map((type) => {
      let verifiedETag: string | undefined
      return {
      type,
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
        if (name === SNAPSHOT_NAME) verifiedETag = res.etag
        if (res.status === 404) return undefined
        if (!res.ok) throw new BizError('SYNC_FAIL', `WebDAV 返回状态 ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      },
      async write(data: Buffer, expected: string | undefined): Promise<void> {
        if (type === 'local') {
          const target = join(cfg.local.dir, SNAPSHOT_NAME)
          const pending = `${target}.${randomUUID()}.tmp`
          await mkdir(cfg.local.dir, { recursive: true })
          const lockPath = target + '.lock'
          const lock = await open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'EEXIST') throw new BizError('SYNC_FAIL', '同步目录正在写入，请稍后重试')
            throw error
          })
          try {
            const existing = await this.read(SNAPSHOT_NAME)
            if ((existing ? hash(existing) : undefined) !== expected) {
              throw new BizError('SYNC_FAIL', '同步目录的快照已变化，请检查远端版本再重试')
            }
            await writeFile(pending, data, { flag: 'wx' })
            await rename(pending, target)
          } finally {
            await lock.close()
            await rm(lockPath, { force: true })
            await rm(pending, { force: true })
          }
          return
        }
        if (expected !== undefined && (!verifiedETag || verifiedETag.startsWith('W/'))) {
          throw new BizError('SYNC_FAIL', 'WebDAV 未提供可校验的快照版本，已停止覆盖')
        }
        const condition: Record<string, string> = expected === undefined ? { 'If-None-Match': '*' } : { 'If-Match': verifiedETag! }
        const res = await webdavPut(davJoin(cfg.webdav.url, SNAPSHOT_NAME), data, cfg.webdav.username, cfg.webdav.password, condition)
        if (res.status === 412) throw new BizError('SYNC_FAIL', 'WebDAV 快照已变化，请检查远端版本再重试')
        if (!res.ok) throw new BizError('SYNC_FAIL', `WebDAV 返回状态 ${res.status}`)
      }
      }
    })
  }

  async function inspectTargets(destinations = targets()) {
    return Promise.all(destinations.map(async (target) => {
      const data = await target.read(SNAPSHOT_NAME)
      return data ? { ...decodeSnapshot(data), bodyHash: hash(data) } : undefined
    }))
  }

  function latest(snapshots: Awaited<ReturnType<typeof inspectTargets>>) {
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
    latest(await inspectTargets())
    return remoteSequence > sequence() ? remoteSequence : 0
  }

  async function checkTargets(): Promise<SyncTargetStatus[]> {
    const baseline = readKey('snapshot_sha256')
    const localVersion = sequence()
    return Promise.all(targets().map(async (target): Promise<SyncTargetStatus> => {
      try {
        const data = await target.read(SNAPSHOT_NAME)
        if (!data) return { target: target.type, state: 'empty', detail: '没有发现当前格式快照，尚未验证写入权限' }
        const { manifest } = decodeSnapshot(data)
        const conflict = manifest.sequence === localVersion && !!baseline && baseline !== manifest.sha256
        const detail = conflict ? '同版本内容不同，请核对同步分支'
          : manifest.sequence > localVersion ? '远端版本领先，请先预览'
          : '快照可读取，校验通过'
        return { target: target.type, state: conflict ? 'conflict' : 'available', sequence: manifest.sequence, timestamp: manifest.timestamp, detail }
      } catch (e) {
        return { target: target.type, state: 'error', detail: e instanceof BizError ? e.message : '无法读取目标，请检查网络、路径和权限' }
      }
    }))
  }

  async function syncNow(): Promise<SyncNowResult> {
    if (uploading) throw new BizError('SYNC_FAIL', '同步进行中')
    const destinations = targets()
    uploading = true
    const temporary = join(tmpdir(), `hesora-sync-${randomUUID()}.db`)
    try {
      const observed = await inspectTargets(destinations)
      const remote = latest(observed)
      if (remoteSequence > sequence()) throw new BizError('SYNC_FAIL', '云盘有更新的快照，请先恢复再上传')
      const baselineHash = readKey('snapshot_sha256')
      if (remote && remoteSequence === sequence() && baselineHash && remote.manifest.sha256 !== baselineHash) {
        throw new BizError('SYNC_FAIL', '云盘与本地存在相同序号的不同快照，请检查同步分支')
      }
      const backup = backupService.backupTo(opts.backupsDir, 'before-sync')
      await copyFile(backup, temporary)
      const copy = new Database(temporary, { fileMustExist: true })
      let fingerprint: string
      try {
        // Secure delete prevents credentials lingering on freed SQLite pages.
        copy.pragma('secure_delete = ON')
        copy.prepare("DELETE FROM app_setting WHERE key LIKE 'sync.%' OR key LIKE 'license.%'").run()
        copy.exec('VACUUM')
        fingerprint = businessFingerprint(copy)
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
        writeKey('snapshot_sha256', manifest.sha256)
      })()
      for (const [index, target] of destinations.entries()) await target.write(payload, observed[index]?.bodyHash)
      writeKey('last_time', timestamp)
      writeKey('business_fingerprint', fingerprint)
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

  async function downloadFrom(source?: 'local' | 'webdav'): Promise<string> {
    if (uploading) throw new BizError('SYNC_FAIL', '同步进行中')
    const destinations = targets().filter((target) => source === undefined || target.type === source)
    if (!destinations.length) throw new BizError('VALIDATION', '所选同步目标尚未配置')
    const snapshot = latest(await inspectTargets(destinations))
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
    lastDownload = { path, manifest: snapshot?.manifest, checksum: hash(content) }
    activePreview = undefined
    return path
  }

  async function discardPreview(token: string): Promise<void> {
    if (activePreview?.token !== token) return
    const { path } = activePreview
    activePreview = undefined
    lastDownload = undefined
    await rm(path, { force: true }).catch(() => undefined)
  }

  async function prepareRestore(source?: 'local' | 'webdav'): Promise<SyncRestorePreview> {
    const path = await downloadFrom(source)
    try {
      const download = lastDownload
      if (!download || download.path !== path) throw new Error('snapshot superseded')
      const copy = new Database(path, { readonly: true, fileMustExist: true })
      let remote: SnapshotSummary
      let remoteHash: string
      try {
        const version = Number(copy.pragma('user_version', { simple: true }))
        const max = Number(db.pragma('user_version', { simple: true }))
        if (version < 1 || version > max || copy.pragma('quick_check', { simple: true }) !== 'ok') {
          throw new Error('incompatible snapshot')
        }
        remote = snapshotSummary(copy)
        remoteHash = businessFingerprint(copy)
      } finally {
        copy.close()
      }
      const local = snapshotSummary(db)
      const localHash = businessFingerprint(db)
      const baseline = readKey('business_fingerprint')
      const localChanged = baseline ? baseline !== localHash : (local.products + local.documents + local.contacts + local.fundAccounts > 0)
      const token = randomUUID()
      activePreview = { token, path, expiresAt: Date.now() + PREVIEW_VALID_MS, localHash, remoteHash, localChanged }
      return { token, sequence: download.manifest?.sequence ?? 0, timestamp: download.manifest?.timestamp ?? null, source, localChanged, local, remote }
    } catch {
      if (lastDownload?.path === path) lastDownload = undefined
      await rm(path, { force: true }).catch(() => undefined)
      throw new BizError('SYNC_FAIL', '快照无法读取、损坏或账套版本不兼容')
    }
  }

  async function restorePreview(token: string, acceptLocalChanges: boolean, operator?: string): Promise<void> {
    const preview = activePreview
    const download = lastDownload
    if (uploading || !preview || !download || token !== preview.token || preview.path !== download.path) {
      throw new BizError('VALIDATION', '请重新预览云盘快照')
    }
    if (preview.localChanged && !acceptLocalChanges) throw new BizError('VALIDATION', '请确认替换本地尚未同步的业务数据')
    try {
      const file = await readFile(download.path)
      if (activePreview !== preview || uploading || Date.now() > preview.expiresAt || hash(file) !== download.checksum ||
          businessFingerprint(db) !== preview.localHash) {
        throw new BizError('SYNC_FAIL', '预览已过期或账套数据已变化，请重新预览')
      }
      backupService.restoreFrom(download.path, opts.getDbFilePath(), opts.backupsDir, operator, {
        sequence: download.manifest?.sequence ?? 0,
        checksum: download.manifest?.sha256 ?? '',
        fingerprint: preview.remoteHash
      })
    } finally {
      await discardPreview(token)
    }
  }

  return {
    backupService, getConfig, saveConfig, syncNow, checkRemote, checkTargets, downloadFrom, prepareRestore, restorePreview, discardPreview,
    isUploading: () => uploading,
    listLocalBackups: () => backupService.listBackups(opts.backupsDir)
  }
}

export type SyncService = ReturnType<typeof createSyncService>
