import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { argon2id } from '@noble/hashes/argon2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { BizError } from '../../shared/result'

// INVBAK v1 binary layout (spec §7), all fields strictly in order:
//   magic 'IVBK' 4B | ver u16 LE =1 | kdf u8 =0x01 | kdfMem u32 LE =65536 |
//   kdfIters u32 LE =3 | kdfParallel u32 LE =1 | salt 16B | iv 12B |
//   ciphertextLen u64 LE | ciphertext (gzip(snapshot) AES-256-GCM) |
//   tag 16B | meta_json (rest, UTF-8 plaintext, NOT covered by GCM)
// meta.snapshotSha256 语义：sha256(snapshot || u32le(dbSchemaVersion)) ——
// 把未认证 meta 中的 dbSchemaVersion 绑进快照指纹，防止篡改 meta 绕过
// restore 的 E_BACKUP_NEWER 门禁。v1.3 未发布，格式 ver 保持 1。
export const INVBAK_MAGIC = 'IVBK'
export const INVBAK_VERSION = 1
const KDF_ID = 0x01
const KDF_MEM_KIB = 65536
const KDF_ITERS = 3
const KDF_PARALLEL = 1
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
// 4 + 2 + 1 + 4 + 4 + 4 + 16 + 12 + 8 = 55
const HEADER_LEN = 55

export interface InvbakMeta {
  backupId: string
  storeName: string
  createdAtUtc: string
  dbSchemaVersion: number
  appVersion: string
  sourceInstanceId: string
  snapshotSha256: string
  sizeBytes: number
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

// 快照指纹：sha256(snapshot || u32le(dbSchemaVersion))。
function snapshotFingerprint(snapshotBytes: Uint8Array, dbSchemaVersion: number): Uint8Array {
  const suffix = Buffer.alloc(4)
  suffix.writeUInt32LE(dbSchemaVersion, 0)
  return sha256(Buffer.concat([Buffer.from(snapshotBytes), suffix]))
}

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return argon2id(passphrase, salt, {
    m: KDF_MEM_KIB,
    t: KDF_ITERS,
    p: KDF_PARALLEL,
    dkLen: 32,
  })
}

function writeU64le(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(value), true)
}

function readU64le(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true))
}

export function createInvbak(snapshotBytes: Uint8Array, opts: {
  passphrase: string
  meta: Omit<InvbakMeta, 'backupId'> & { backupId?: string }
}): Uint8Array {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(opts.passphrase, salt)
  const compressed = gzipSync(snapshotBytes)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  const tag = cipher.getAuthTag()

  const meta: InvbakMeta = {
    ...opts.meta,
    backupId: opts.meta.backupId ?? randomUUID(),
  }
  // 指纹按容器内最终 meta 的 dbSchemaVersion 计算（含 schema 绑定，见文件头注释）。
  meta.snapshotSha256 = toHex(snapshotFingerprint(snapshotBytes, meta.dbSchemaVersion))
  const metaJson = Buffer.from(JSON.stringify(meta), 'utf8')

  const out = Buffer.alloc(HEADER_LEN + ciphertext.length + TAG_LEN + metaJson.length)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out.write(INVBAK_MAGIC, 0, 'ascii')
  view.setUint16(4, INVBAK_VERSION, true)
  view.setUint8(6, KDF_ID)
  view.setUint32(7, KDF_MEM_KIB, true)
  view.setUint32(11, KDF_ITERS, true)
  view.setUint32(15, KDF_PARALLEL, true)
  salt.copy(out, 19)
  iv.copy(out, 35)
  writeU64le(view, 47, ciphertext.length)
  ciphertext.copy(out, HEADER_LEN)
  tag.copy(out, HEADER_LEN + ciphertext.length)
  metaJson.copy(out, HEADER_LEN + ciphertext.length + TAG_LEN)
  return out
}

export function readInvbak(bytes: Uint8Array, opts: { passphrase: string }): {
  meta: InvbakMeta
  snapshotBytes: Uint8Array
} {
  const buf = Buffer.from(bytes)
  if (buf.length < HEADER_LEN + TAG_LEN + 2 || buf.subarray(0, 4).toString('ascii') !== INVBAK_MAGIC) {
    throw new BizError('E_INVBAK_MAGIC', '不是有效的 INVBAK 备份容器（magic 不符）')
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const version = view.getUint16(4, true)
  if (version !== INVBAK_VERSION) {
    throw new BizError('E_INVBAK_VERSION', `不支持的容器版本: ${version}`)
  }
  const kdfId = view.getUint8(6)
  const kdfMem = view.getUint32(7, true)
  const kdfIters = view.getUint32(11, true)
  const kdfParallel = view.getUint32(15, true)
  if (kdfId !== KDF_ID || kdfMem !== KDF_MEM_KIB || kdfIters !== KDF_ITERS || kdfParallel !== KDF_PARALLEL) {
    throw new BizError('E_INVBAK_KDF', '不支持的密钥派生参数')
  }
  const salt = buf.subarray(19, 19 + SALT_LEN)
  const iv = buf.subarray(35, 35 + IV_LEN)
  const ciphertextLen = readU64le(view, 47)
  const ciphertextStart = HEADER_LEN
  const ciphertextEnd = ciphertextStart + ciphertextLen
  const tagStart = ciphertextEnd
  const tagEnd = tagStart + TAG_LEN
  if (ciphertextEnd > buf.length || tagEnd > buf.length) {
    throw new BizError('E_INVBAK_INVALID', '容器数据被截断或损坏')
  }
  const ciphertext = buf.subarray(ciphertextStart, ciphertextEnd)
  const tag = buf.subarray(tagStart, tagEnd)
  const metaJson = buf.subarray(tagEnd)

  const key = deriveKey(opts.passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let compressed: Buffer
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new BizError('E_INVBAK_INVALID', '口令错误或密文被篡改（GCM 认证失败）')
  }

  let meta: InvbakMeta
  try {
    meta = JSON.parse(metaJson.toString('utf8')) as InvbakMeta
  } catch {
    throw new BizError('E_INVBAK_INVALID', 'meta_json 解析失败')
  }
  // meta 最小字段校验（M4）：meta 不受 GCM 保护，缺失/类型错直接拒。
  const okMeta = typeof meta.backupId === 'string' && meta.backupId.length > 0 &&
    typeof meta.storeName === 'string' &&
    typeof meta.createdAtUtc === 'string' && meta.createdAtUtc.length > 0 &&
    typeof meta.dbSchemaVersion === 'number' && Number.isInteger(meta.dbSchemaVersion) && meta.dbSchemaVersion >= 0 &&
    typeof meta.appVersion === 'string' &&
    typeof meta.sourceInstanceId === 'string' &&
    typeof meta.snapshotSha256 === 'string' && /^[0-9a-f]{64}$/.test(meta.snapshotSha256) &&
    typeof meta.sizeBytes === 'number' && Number.isInteger(meta.sizeBytes) && meta.sizeBytes >= 0
  if (!okMeta) {
    throw new BizError('E_INVBAK_INVALID', 'meta_json 字段缺失或类型不符')
  }

  let snapshot: Buffer
  try {
    snapshot = gunzipSync(compressed)
  } catch {
    throw new BizError('E_INVBAK_INVALID', '快照数据解压失败')
  }
  const actualSha = toHex(snapshotFingerprint(snapshot, meta.dbSchemaVersion))
  if (!constantTimeHexEqual(meta.snapshotSha256, actualSha)) {
    throw new BizError('E_INVBAK_HASH_MISMATCH', '快照 sha256 校验不一致')
  }
  return { meta, snapshotBytes: new Uint8Array(snapshot) }
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false // hex 长度不符直接拒，不进 timing 比较
  return timingSafeEqual(ba, bb)
}
