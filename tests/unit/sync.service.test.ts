import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openMemDb } from '../helpers/mem-db'
import { createSyncService } from '../../src/main/services/sync/sync.service'
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
    const res = await webdavPut(`${base}/dav/zhjs-erp.db`, Buffer.from('data123'), 'u', 'p')
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
  let uploads: { url: string; auth: string | null; body: string }[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhjs-sync-'))
    seenDir = dir
    dbFile = join(dir, 'zhjs-erp.db')
    await writeFile(dbFile, 'db-v1')
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        if (req.method === 'PUT') {
          uploads.push({ url: req.url ?? '', auth: req.headers.authorization ?? null, body })
          res.writeHead((req.url ?? '').startsWith('/bad') ? 500 : 201)
        } else if (req.method === 'GET') {
          if ((req.url ?? '').startsWith('/bad')) {
            res.writeHead(500)
          } else {
            res.writeHead(200)
            res.end('remote-db-content')
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
    expect(await readFile(join(target, 'zhjs-erp.db'), 'utf8')).toBe('db-v1')
    expect(svc.getConfig().last_time).not.toBe('')
  })

  it('webdav sync puts file with auth and always backs up locally first', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/dav/`, username: 'u', password: 'p' } })
    const r = await svc.syncNow()
    expect(r.ok).toBe(true)
    expect(uploads.length).toBe(1)
    expect(uploads[0]!.url).toBe('/dav/zhjs-erp.db')
    expect(uploads[0]!.auth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
    expect(uploads[0]!.body).toBe('db-v1')
    expect(svc.listLocalBackups().length).toBeGreaterThanOrEqual(1)
  })

  it('webdav sync fails with SYNC_FAIL on bad status', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/bad`, username: '', password: '' } })
    await expect(svc.syncNow()).rejects.toThrow(/同步失败/)
  })

  it('downloadFrom writes remote content to temp file', async () => {
    const { svc } = makeSvc()
    svc.saveConfig({ type: 'webdav', webdav: { url: `${base}/dav/zhjs-erp.db`, username: 'u', password: 'p' } })
    const p = await svc.downloadFrom()
    expect(await readFile(p, 'utf8')).toBe('remote-db-content')
    expect(p).toMatch(/\.db$/)
  })
})
