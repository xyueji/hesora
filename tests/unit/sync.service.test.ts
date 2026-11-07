import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openMemDb } from '../helpers/mem-db'
import { createSyncService } from '../../src/main/services/sync/sync.service'
import Database from 'better-sqlite3'
import { decodeSnapshot } from '../../src/main/services/sync/sync.service'
import { webdavPut, webdavGet } from '../../src/main/services/sync/webdav'

describe('webdav client', () => {
  let server: Server
  let base: string
  let seen: { method: string; url: string; auth: string | null; body: string }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? null, body })
        if (req.method === 'PUT') {
          res.writeHead(req.url === '/bad' ? 500 : 201)
        } else if (req.method === 'GET') {
          if (req.url === '/file.db') {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
            res.end('remote-content')
            return
          }
          res.writeHead(404)
        } else {
          res.writeHead(207)
        }
        res.end()
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await rm(seenDir, { recursive: true, force: true }).catch(() => {})
  })

  it('put sends body with basic auth header', async () => {
    const res = await webdavPut(`${base}/dav/`, Buffer.from('data123'), 'u', 'p')
    expect(res.ok).toBe(true)
    const put = seen.find((s) => s.method === 'PUT' && s.body === 'data123')
    expect(put).toBeDefined()
    expect(put?.auth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('get returns content', async () => {
    const res = await webdavGet(`${base}/file.db`, 'u', 'p')
    expect(res.ok).toBe(true)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('remote-content')
  })
})

let seenDir: string

describe('sync.service', () => {
  let dir: string
  let dbFile: string
  let server: Server
  let base: string
  let uploads: { url: string; auth: string | null; body: Buffer }[] = []
  let davHead: Buffer | undefined
  let rejectDavWrite = false
  const davConditions: Array<string | string[] | undefined> = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhjs-sync-'))
    seenDir = dir
    dbFile = join(dir, 'zhjs-erp.db')
    await writeFile(dbFile, 'db-v1')
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        if (req.url?.startsWith('/conditional/')) {
          if (req.method === 'GET') {
            res.writeHead(davHead ? 200 : 404, davHead ? { ETag: '"snapshot-1"' } : undefined)
            res.end(davHead)
          } else {
            davConditions.push(davHead ? req.headers['if-match'] : req.headers['if-none-match'])
            if (rejectDavWrite) res.writeHead(412)
            else { davHead = body; res.writeHead(201) }
            res.end()
          }
          return
        }
        if (req.method === 'PUT') {
          uploads.push({ url: req.url ?? '', auth: req.headers.authorization ?? null, body })
          res.writeHead((req.url ?? '').startsWith('/bad') ? 500 : 201)
        } else if (req.method === 'GET') {
          if ((req.url ?? '').startsWith('/bad')) {
            res.writeHead(500)
          } else if (req.url?.endsWith('/zhjs-erp.db')) {
            res.writeHead(200)
            res.end('remote-db-content')
          } else {
            res.writeHead(404)
          }
        } else {
          res.writeHead(207)
        }
        res.end()
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await rm(dir, { recursive: true, force: true })
  })

  function makeSvc() {
    const db = openMemDb()
    return { db, svc: createSyncService(db, { getDbFilePath: () => dbFile, backupsDir: dir }) }
  }

  it('getConfig returns defaults when unconfigured', () => {
    const { svc } = makeSvc()
    expect(svc.getConfig()).toEqual({ type: '', webdav: { url: '', username: '', password: '' }, local: { dir: '' }, last_time: '' })
  })

  it('saveConfig persists keys and getConfig reads back', () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/dav/`, username: 'u', password: 'p' } })
    expect(svc.getConfig().type).toBe('webdav')
    expect(svc.getConfig().webdav.url).toBe(`${base}/dav/`)
  })

  it('syncNow throws when config missing', async () => {
    const { svc } = makeSvc()
    await expect(svc.syncNow()).rejects.toThrow(/请先配置同步目标/)
  })

  it('local sync copies db file to dir and sets last_time', async () => {
    const target = join(dir, 'target-local')
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'local', local: { dir: target } })
    const r = await svc.syncNow()
    expect(r.ok).toBe(true)
    const snapshot = decodeSnapshot(await readFile(join(target, 'hesora-inventory.zjsnap')))
    expect(snapshot.manifest.sequence).toBe(1)
    const path = await svc.downloadFrom()
    try {
      const copy = new Database(path, { readonly: true })
      expect(copy.prepare('SELECT count(*) FROM product').pluck().get()).toBe(0)
      expect(copy.prepare("SELECT value FROM app_setting WHERE key LIKE 'sync.%'").all()).toEqual([])
      copy.close()
    } finally {
      await rm(path, { force: true })
    }
    expect(svc.getConfig().last_time).not.toBe('')
  })

  it('webdav sync puts file with auth and always backs up locally first', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/dav/`, username: 'u', password: 'p' } })
    const r = await svc.syncNow()
    expect(r.ok).toBe(true)
    expect(uploads.length).toBe(1)
    expect(uploads[0]!.url).toBe('/dav/hesora-inventory.zjsnap')
    expect(uploads[0]!.auth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
    expect(decodeSnapshot(uploads[0]!.body).manifest.sequence).toBe(1)
    expect(svc.listLocalBackups().length).toBeGreaterThanOrEqual(1)
  })

  it('webdav sync fails with SYNC_FAIL on bad status', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/bad`, username: '', password: '' } })
    await expect(svc.syncNow()).rejects.toThrow(/同步失败/)
  })

  it('downloadFrom writes remote content to temp file', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/dav/`, username: 'u', password: 'p' } })
    const p = await svc.downloadFrom()
    expect(await readFile(p, 'utf8')).toBe('remote-db-content')
    expect(p).toMatch(/\.db$/)
    await rm(p, { force: true })
  })

  it('sends conditional WebDAV writes and reports a 412 as a conflict', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/conditional`, username: '', password: '' } })
    await svc.syncNow()
    rejectDavWrite = true
    await expect(svc.syncNow()).rejects.toThrow(/快照已变化/)
    expect(davConditions).toEqual(['*', '"snapshot-1"'])
    expect(decodeSnapshot(davHead!).manifest.sequence).toBe(1)
  })

  it('checks each configured target independently when another is offline', async () => {
    const { svc } = makeSvc()
    const remote = join(dir, 'probe-directory')
    svc.saveConfig({ type: 'local', local: { dir: remote } })
    await svc.syncNow()
    svc.saveConfig({ type: 'both', webdav: { url: `${base}/bad`, username: '', password: '' } })
    const statuses = await svc.checkTargets()
    expect(statuses).toMatchObject([{ target: 'local', state: 'available', sequence: 1 }, { target: 'webdav', state: 'error' }])
    const preview = await svc.prepareRestore('local')
    expect(preview).toMatchObject({ source: 'local', sequence: 1 })
    await svc.discardPreview(preview.token)
  })
})



it('blocks a second device from overwriting a newer remote snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hesora-sync-conflict-'))
  const writerDb = openMemDb()
  const readerDb = openMemDb()
  try {
    const options = { getDbFilePath: () => join(directory, 'hesora-inventory.db'), backupsDir: join(directory, 'backups') }
    const writer = createSyncService(writerDb, options)
    const reader = createSyncService(readerDb, options)
    const config = { type: 'local' as const, local: { dir: join(directory, 'remote') } }
    writer.saveConfig(config)
    reader.saveConfig(config)
    await writer.syncNow()
    await writer.syncNow()
    expect(await reader.checkRemote()).toBe(2)
    await expect(reader.syncNow()).rejects.toThrow(/先恢复/)
    expect(reader.getConfig().remoteSequence).toBe(2)
  } finally {
    writerDb.close()
    readerDb.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('previews remote and local records and blocks stale or unacknowledged replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hesora-sync-preview-'))
  const writerDb = openMemDb()
  const localDb = openMemDb()
  try {
    const config = { type: 'local' as const, local: { dir: join(dir, 'remote') } }
    const writer = createSyncService(writerDb, { getDbFilePath: () => join(dir, 'writer.db'), backupsDir: join(dir, 'writer-backups') })
    const local = createSyncService(localDb, { getDbFilePath: () => join(dir, 'local.db'), backupsDir: join(dir, 'local-backups') })
    writer.saveConfig(config)
    local.saveConfig(config)
    writerDb.exec("INSERT INTO product (code, name, base_unit) VALUES ('P01', '云盘商品', '件')")
    localDb.exec("INSERT INTO product (code, name, base_unit) VALUES ('LOCAL', '本地新增商品', '件')")
    await writer.syncNow()
    const preview = await local.prepareRestore()
    expect(preview).toMatchObject({ sequence: 1, localChanged: true, local: { products: 1 }, remote: { products: 1 } })
    await expect(local.restorePreview(preview.token, false)).rejects.toThrow(/确认/)
    localDb.exec("UPDATE product SET name = '预览后改名' WHERE code = 'LOCAL'")
    await expect(local.restorePreview(preview.token, true)).rejects.toThrow(/重新预览/)
    expect(localDb.prepare("SELECT name FROM product WHERE code = 'LOCAL'").pluck().get()).toBe('预览后改名')
    const latest = await local.prepareRestore()
    await local.restorePreview(latest.token, true)
    expect((await readFile(join(dir, 'local.db.restore'))).length).toBeGreaterThan(0)
  } finally {
    writerDb.close()
    localDb.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('allows only one publisher when two local-folder writers observe the same starting point', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hesora-sync-race-'))
  const first = openMemDb()
  const second = openMemDb()
  try {
    const makeWriter = (db: Database.Database, name: string) => {
      const svc = createSyncService(db, { getDbFilePath: () => join(dir, name + '.db'), backupsDir: join(dir, name) })
      svc.saveConfig({ type: 'local', local: { dir: join(dir, 'remote') } })
      return svc
    }
    const results = await Promise.allSettled([makeWriter(first, 'first').syncNow(), makeWriter(second, 'second').syncNow()])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(decodeSnapshot(await readFile(join(dir, 'remote', 'hesora-inventory.zjsnap'))).manifest.sequence).toBe(1)
  } finally {
    first.close()
    second.close()
    await rm(dir, { recursive: true, force: true })
  }
})
