import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemDb } from '../helpers/mem-db'
import { createAttachmentService } from '../../src/main/services/attachment/attachment.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hesora-att-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function seedDoc(db: Parameters<typeof createPurchaseService>[0]): number {
  db.exec(`
    INSERT INTO warehouse (id, code, name) VALUES (1, 'W', '主仓');
    INSERT INTO product (id, code, name, base_unit) VALUES (1, 'P', '商品', '件');
  `)
  return createPurchaseService(db).create({
    date: '2026-01-10',
    warehouse_id: 1,
    items: [{ product_id: 1, qty: 1, price: 1 }]
  }).id
}

describe('attachment.service', () => {
  it('save → list → read → remove round-trip writes and deletes the file', () => {
    const db = openMemDb()
    const dir = tempDir()
    const docId = seedDoc(db)
    const svc = createAttachmentService(db, dir)
    const data = Buffer.from('hello png').toString('base64')
    const id = svc.save({ doc_id: docId, file_name: '拍照.png', data }) as number
    expect(id).toBeGreaterThan(0)

    const list = svc.listByDoc(docId)
    expect(list).toHaveLength(1)
    const att = list[0]!
    expect(att).toMatchObject({ doc_id: docId, file_name: '拍照.png', size: 9 })
    // 文件确实写入 attachments 目录
    expect(existsSync(join(dir, att.file_path))).toBe(true)

    const back = svc.read(id)
    expect(Buffer.from(back.data, 'base64').toString()).toBe('hello png')

    svc.remove(id)
    expect(svc.listByDoc(docId)).toHaveLength(0)
    expect(existsSync(join(dir, att.file_path))).toBe(false)
    db.close()
  })

  it('save accepts Buffer data and rejects missing doc', () => {
    const db = openMemDb()
    const dir = tempDir()
    const svc = createAttachmentService(db, dir)
    expect(() => svc.save({ doc_id: 999, file_name: 'a.png', data: Buffer.from('x') })).toThrowError(/单据/)
    expect(() => svc.save({ doc_id: 1, file_name: 'a.png', data: '' })).toThrowError()
    db.close()
  })

  it('read/remove on unknown id throws NOT_FOUND', () => {
    const db = openMemDb()
    const svc = createAttachmentService(db, tempDir())
    expect(() => svc.read(123)).toThrowError(/附件/)
    expect(() => svc.remove(123)).toThrowError(/附件/)
    db.close()
  })

  it('generates unique file paths for same-name uploads', () => {
    const db = openMemDb()
    const dir = tempDir()
    const docId = seedDoc(db)
    const svc = createAttachmentService(db, dir)
    const data = Buffer.from('abc').toString('base64')
    const a = svc.save({ doc_id: docId, file_name: 'img.png', data }) as number
    const b = svc.save({ doc_id: docId, file_name: 'img.png', data }) as number
    const paths = svc.listByDoc(docId).map((r) => r.file_path)
    expect(new Set(paths).size).toBe(2)
    expect(readFileSync(join(dir, paths[0] ?? '')).toString()).toBe('abc')
    svc.remove(a)
    svc.remove(b)
    db.close()
  })

  it('rejects unsupported file extension', () => {
    const db = openMemDb()
    const svc = createAttachmentService(db, tempDir())
    const docId = seedDoc(db)
    expect(() => svc.save({ doc_id: docId, file_name: 'evil.exe', data: 'aGk=' })).toThrowError(/图片/)
    db.close()
  })

  it('writeFileSync interop: data round-trips byte-exact', () => {
    const db = openMemDb()
    const dir = tempDir()
    const docId = seedDoc(db)
    const svc = createAttachmentService(db, dir)
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
    const id = svc.save({ doc_id: docId, file_name: 'raw.png', data: raw }) as number
    const row = svc.listByDoc(docId)[0]!
    expect(readFileSync(join(dir, row.file_path)).equals(raw)).toBe(true)
    expect(Buffer.from(svc.read(id).data, 'base64').equals(raw)).toBe(true)
    db.close()
  })
})

describe('writeFileSync sanity (temp harness)', () => {
  it('tmp dir is writable', () => {
    const dir = tempDir()
    const file = join(dir, 'probe.txt')
    writeFileSync(file, 'ok')
    expect(readFileSync(file, 'utf8')).toBe('ok')
  })
})
