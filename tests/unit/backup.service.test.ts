import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemDb } from '../helpers/mem-db'
import { createBackupService } from '../../src/main/services/backup/backup.service'

let dir: string
let dbFile: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zhjs-backup-'))
  dbFile = join(dir, 'zhjs-erp.db')
  await writeFile(dbFile, 'hello-db')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('backup.service', () => {
  it('backupTo creates timestamped file and returns path', async () => {
    const svc = createBackupService(openMemDb(), dbFile)
    const p = svc.backupTo(dir)
    expect(p).toMatch(/zhjs-erp-backup-\d{8}-\d{6}\.db$/)
    expect(await readFile(p, 'utf8')).toBe('hello-db')
  })

  it('listBackups returns only *.db sorted desc', async () => {
    await writeFile(join(dir, 'zhjs-erp-backup-20240101-000000.db'), 'old')
    await writeFile(join(dir, 'readme.txt'), 'noise')
    const svc = createBackupService(openMemDb(), dbFile)
    const list = svc.listBackups(dir)
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list.every((b) => b.name.endsWith('.db'))).toBe(true)
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.mtime >= list[i]!.mtime).toBe(true)
    }
    expect(list.some((b) => b.name === 'readme.txt')).toBe(false)
  })

  it('checkpoint does not throw', () => {
    const db = openMemDb()
    db.prepare('CREATE TABLE IF NOT EXISTS t (x)').run()
    const svc = createBackupService(db, dbFile)
    expect(() => svc.backupTo(dir)).not.toThrow()
  })

  it('restoreFrom replaces content and creates before-restore safety copy', async () => {
    const backupDir = await mkdtemp(join(tmpdir(), 'zhjs-restore-'))
    const current = join(backupDir, 'zhjs-erp.db')
    await writeFile(current, 'current-content')
    const backup = join(backupDir, 'zhjs-erp-backup-20240102-030405.db')
    await writeFile(backup, 'backup-content')
    const svc = createBackupService(openMemDb(), current)
    svc.restoreFrom(backup, current)
    expect(await readFile(current, 'utf8')).toBe('backup-content')
    const safety = svc.listBackups(backupDir).filter((b) => b.name.includes('before-restore'))
    expect(safety.length).toBe(1)
    expect(await readFile(join(backupDir, safety[0]!.name), 'utf8')).toBe('current-content')
    await rm(backupDir, { recursive: true, force: true })
  })

  it('restoreFrom throws when backup file missing', () => {
    const svc = createBackupService(openMemDb(), dbFile)
    expect(() => svc.restoreFrom(join(dir, 'nope.db'), dbFile)).toThrow()
  })
})
