import type { Database } from 'better-sqlite3'
import { verify } from 'node:crypto'
import { BizError } from '../../../shared/result'
import { LICENSE_PUBLIC_KEY, LICENSE_CODE_PREFIX, TRIAL_DAYS, type LicensePayload } from '../../../shared/license'

export type DB = Database

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  daysLeft?: number
  activatedAt?: string
  customer?: string
}

interface SettingRow {
  key: string
  value: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseCode(code: string, publicKeyPem: string): LicensePayload | null {
  if (typeof code !== 'string' || !code.startsWith(LICENSE_CODE_PREFIX)) return null
  const parts = code.slice(LICENSE_CODE_PREFIX.length).split('.')
  if (parts.length !== 2) return null
  const [bodyB64, sigB64] = parts
  let canonical: string
  let sig: Buffer
  try {
    canonical = Buffer.from(bodyB64 as string, 'base64url').toString('utf8')
    sig = Buffer.from(sigB64 as string, 'base64url')
  } catch {
    return null
  }
  let payload: LicensePayload
  try {
    const obj = JSON.parse(canonical) as Partial<LicensePayload>
    if (typeof obj.customer !== 'string' || typeof obj.issuedAt !== 'string') return null
    payload = {
      customer: obj.customer,
      issuedAt: obj.issuedAt,
      expiresAt: obj.expiresAt ?? null,
      machine: obj.machine ?? null
    }
  } catch {
    return null
  }
  const ok = verify(null, Buffer.from(canonical, 'utf8'), publicKeyPem, sig)
  return ok ? payload : null
}

export function createLicenseService(db: DB, publicKeyPem: string = LICENSE_PUBLIC_KEY) {
  function verifyFormat(code: string): LicensePayload | null {
    return parseCode(code, publicKeyPem)
  }

  function setSetting(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(key, value)
  }
  function getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
      | SettingRow
      | undefined
    return row ? row.value : null
  }

  function getStatus(): LicenseStatus {
    const stored = getSetting('license.code')
    if (stored) {
      const payload = verifyFormat(stored)
      if (payload) {
        return {
          mode: 'licensed',
          activatedAt: getSetting('license.activated_at') ?? undefined,
          customer: payload.customer
        }
      }
      // stored code invalid (db tampered) → fall through to trial
    }
    // trial start on first check
    let start = getSetting('license.start')
    if (!start) {
      start = new Date().toISOString()
      setSetting('license.start', start)
    }
    const elapsedDays = Math.floor((Date.now() - new Date(start).getTime()) / DAY_MS)
    return { mode: 'trial', daysLeft: Math.max(0, TRIAL_DAYS - elapsedDays) }
  }

  function activate(code: string): LicensePayload {
    const payload = verifyFormat(code)
    if (!payload) throw new BizError('LICENSE_INVALID', '激活码无效')
    setSetting('license.code', code)
    setSetting('license.activated_at', new Date().toISOString())
    return payload
  }

  // test seam: simulate direct db tampering of the stored code
  function _testSetStoredCode(code: string): void {
    setSetting('license.code', code)
  }

  return { verifyFormat, getStatus, activate, _testSetStoredCode }
}

export type LicenseService = ReturnType<typeof createLicenseService>
