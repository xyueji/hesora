import 'reflect-metadata'
import 'reflect-metadata'
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ensureHostCertificate } from '../../src/main/host/cert'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('ensureHostCertificate', () => {
  it('first call generates cert+key files on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-cert-'))
    dirs.push(dir)
    const r = await ensureHostCertificate(dir)
    expect(existsSync(join(dir, 'host-cert.pem'))).toBe(true)
    expect(existsSync(join(dir, 'host-key.pem'))).toBe(true)
    expect(r.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(r.keyPem).toContain('PRIVATE KEY')
    expect(r.fingerprintHex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('second call returns the same fingerprint (stable across restarts)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-cert-'))
    dirs.push(dir)
    const r1 = await ensureHostCertificate(dir)
    const r2 = await ensureHostCertificate(dir)
    expect(r2.fingerprintHex).toBe(r1.fingerprintHex)
    expect(r2.certPem).toBe(r1.certPem)
  })

  it('fingerprint equals sha256 of certificate DER', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-cert-'))
    dirs.push(dir)
    const r = await ensureHostCertificate(dir)
    // PEM body is base64 DER
    const der = Buffer.from(
      r.certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
      'base64'
    )
    const fp = createHash('sha256').update(der).digest('hex')
    expect(r.fingerprintHex).toBe(fp)
  })
})
