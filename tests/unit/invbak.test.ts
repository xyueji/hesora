import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createInvbak, readInvbak } from '../../src/main/backup/invbak'
import { BizError } from '../../src/shared/result'

const PASS = 'correct horse battery staple'
// 共享派生成本：多断言复用少量备份文件。
const SNAPSHOT = new Uint8Array(1024 * 1024)
{
  // 确定性伪随机 1MB
  let s = 0x12345678
  for (let i = 0; i < SNAPSHOT.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    SNAPSHOT[i] = s & 0xff
  }
}
const META_BASE = {
  storeName: '禾序测试店',
  createdAtUtc: '2026-11-09T10:00:00.000Z',
  dbSchemaVersion: 83,
  appVersion: '1.3.0',
  sourceInstanceId: '11111111-2222-3333-4444-555555555555',
  snapshotSha256: '',
  sizeBytes: SNAPSHOT.length,
}
// 实际创建时用真实 sha256 —— 用单次派生建立主样本。
const SAMPLE = createInvbak(SNAPSHOT, {
  passphrase: PASS,
  meta: { ...META_BASE, snapshotSha256: sha256Hex(SNAPSHOT) },
})

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function roundtrip(): { meta: ReturnType<typeof readInvbak>['meta']; bytes: Uint8Array } {
  const r = readInvbak(SAMPLE, { passphrase: PASS })
  return { meta: r.meta, bytes: r.snapshotBytes }
}

describe('invbak roundtrip', () => {
  it('roundtrips 1MB snapshot byte-identically', () => {
    const { bytes, meta } = roundtrip()
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(SNAPSHOT))).toBe(0)
    expect(meta.storeName).toBe(META_BASE.storeName)
    expect(meta.dbSchemaVersion).toBe(83)
    expect(meta.appVersion).toBe('1.3.0')
    expect(meta.sourceInstanceId).toBe(META_BASE.sourceInstanceId)
    expect(meta.sizeBytes).toBe(SNAPSHOT.length)
    expect(meta.backupId).toMatch(/^[0-9a-f-]{36}$/)
    expect(meta.createdAtUtc).toBe(META_BASE.createdAtUtc)
  })

  it('honors explicit backupId and generates uuid when absent', () => {
    const b = createInvbak(SNAPSHOT, {
      passphrase: PASS,
      meta: { ...META_BASE, snapshotSha256: sha256Hex(SNAPSHOT), backupId: 'fixed-id' },
    })
    expect(readInvbak(b, { passphrase: PASS }).meta.backupId).toBe('fixed-id')
  })
})

describe('invbak tamper & format errors', () => {
  it('rejects wrong passphrase with E_INVBAK_INVALID and distinct message', () => {
    expect(() => readInvbak(SAMPLE, { passphrase: 'wrong' })).toThrowError(BizError)
    try {
      readInvbak(SAMPLE, { passphrase: 'wrong' })
    } catch (e) {
      expect((e as BizError).code).toBe('E_INVBAK_INVALID')
      expect((e as BizError).message).toContain('口令错误或密文被篡改')
    }
  })

  it('rejects tampered ciphertext byte', () => {
    const copy = Buffer.from(SAMPLE)
    copy[100]! ^= 0xff
    expect(() => readInvbak(copy, { passphrase: PASS })).toThrowError(/E_INVBAK_INVALID|口令错误|篡改/)
  })

  it('rejects tampered tag byte', () => {
    const copy = Buffer.from(SAMPLE)
    // tag 紧跟密文尾部：header 55 + ciphertextLen 处是 tag 起点
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
    const ctLen = Number(view.getBigUint64(47, true))
    copy[55 + ctLen]! ^= 0x01
    expect(() => readInvbak(copy, { passphrase: PASS })).toThrowError(BizError)
  })

  it('rejects tampered meta_json via sha256 check (GCM does not cover meta)', () => {
    const copy = Buffer.from(SAMPLE)
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
    const ctLen = Number(view.getBigUint64(47, true))
    const metaStart = 55 + ctLen + 16
    // 篡改 meta 里的 snapshotSha256 字段（GCM 不覆盖 meta → 解密成功，但 sha256 校验拒绝）
    const metaStr = copy.subarray(metaStart).toString('utf8').replace(/"snapshotSha256":"[0-9a-f]{64}"/, '"snapshotSha256":"' + '0'.repeat(64) + '"')
    const newMeta = Buffer.from(metaStr, 'utf8')
    const out = Buffer.concat([copy.subarray(0, metaStart), newMeta])
    expect(() => readInvbak(out, { passphrase: PASS })).toThrowError(BizError)
    try {
      readInvbak(out, { passphrase: PASS })
    } catch (e) {
      expect((e as BizError).code).toBe('E_INVBAK_HASH_MISMATCH')
    }
  })

  it('rejects bad magic with E_INVBAK_MAGIC', () => {
    const copy = Buffer.from(SAMPLE)
    copy.write('XXXX', 0, 'ascii')
    try {
      readInvbak(copy, { passphrase: PASS })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('E_INVBAK_MAGIC')
    }
  })

  it('rejects version 99 with E_INVBAK_VERSION', () => {
    const copy = Buffer.from(SAMPLE)
    copy.writeUInt16LE(99, 4)
    try {
      readInvbak(copy, { passphrase: PASS })
      expect.unreachable()
    } catch (e) {
      expect((e as BizError).code).toBe('E_INVBAK_VERSION')
    }
  })

  it('rejects empty and truncated inputs', () => {
    expect(() => readInvbak(new Uint8Array(0), { passphrase: PASS })).toThrowError(BizError)
    expect(() => readInvbak(SAMPLE.subarray(0, 30), { passphrase: PASS })).toThrowError(BizError)
    expect(() => readInvbak(SAMPLE.subarray(0, 60), { passphrase: PASS })).toThrowError(BizError)
  })
})
