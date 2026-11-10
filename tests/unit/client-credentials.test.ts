// v1.4 终审 S6 补齐：客户端凭据存储的 DPAPI 安全红线 + remove 彻底性。
// 裁定：DPAPI 不可用时决不明文落盘；「忘记主机」即使 DPAPI 临时不可用也必须删掉旧密文。
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { createHostCredentialStore } from '../../src/main/host/client-credentials'
import type { SafeStorageLike } from '../../src/main/host/secret-store'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hx-creds-'))
  dirs.push(d)
  return d
}

/** 可逆的假 DPAPI：encryptString → base64 包装（模拟密文，不含明文可辨字节）。 */
function fakeSafeStorage(on: () => boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: on,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const t = b.toString('utf8')
      if (!t.startsWith('enc:')) throw new Error('bad cipher')
      return t.slice(4)
    }
  } as SafeStorageLike
}

describe('client credential store', () => {
  it('DPAPI 可用时保存/读取对称，落盘内容是密文不含明文口令', () => {
    const dir = tmpDir()
    const store = createHostCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage(() => true) })
    const cred = { secretHex: 'aa11', fingerprintHex: 'bb22', token: 'cc33' }
    expect(store.available()).toBe(true)
    expect(store.save('https://host:18650', cred)).toBe(true)
    expect(store.load('https://host:18650')).toEqual(cred)
    const raw = readFileSync(join(dir, 'client-credentials.json'), 'utf8')
    // 明文三个字段都不得出现在磁盘字节里（要么被 enc 包装，要么 base64 化）
    expect(raw).not.toContain('aa11')
    expect(raw).not.toContain('bb22')
    expect(raw).not.toContain('cc33')
  })

  it('DPAPI 不可用时 save 返回 false 且决不写文件（不明文落盘）', () => {
    const dir = tmpDir()
    const store = createHostCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage(() => false) })
    expect(store.available()).toBe(false)
    expect(store.save('https://host:18650', { secretHex: 'a', fingerprintHex: 'b', token: 'c' })).toBe(false)
    expect(existsSync(join(dir, 'client-credentials.json'))).toBe(false)
    // 读取也降级为空，不抛错
    expect(store.load('https://host:18650')).toEqual({ secretHex: '', fingerprintHex: '', token: '' })
  })

  it('remove 在 DPAPI 变得不可用后仍能删掉已落盘的旧密文（终审 S2）', () => {
    const dir = tmpDir()
    let on = true
    const store = createHostCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage(() => on) })
    store.save('https://host:18650', { secretHex: 'aa11', fingerprintHex: 'bb22', token: 'cc33' })
    expect(store.load('https://host:18650').secretHex).toBe('aa11')
    on = false // DPAPI 临时不可用
    store.remove('https://host:18650')
    on = true // 恢复后再读，旧凭据必须已不在
    expect(store.load('https://host:18650')).toEqual({ secretHex: '', fingerprintHex: '', token: '' })
  })

  it('损坏/被篡改的凭据文件读取优雅降级为空', () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'client-credentials.json'), 'not-json', 'utf8')
    const store = createHostCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage(() => true) })
    expect(store.load('https://host:18650')).toEqual({ secretHex: '', fingerprintHex: '', token: '' })
  })
})
