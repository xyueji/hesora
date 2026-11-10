import type { Database } from 'better-sqlite3'
import { randomUUID, verify } from 'node:crypto'
import { BizError } from '../../../shared/result'
import { LICENSE_CODE_PREFIX, TRIAL_DAYS, type LicensePayload, type TrialPhase } from '../../../shared/license'

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  /** 新试用策略的阶段：trial(1-7天，全功能) → expired(第 7 天起，只读)；激活后 activated。 */
  phase: TrialPhase
  daysLeft?: number
  activatedAt?: string
  customer?: string
  onlineAvailable?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000
const ROLLBACK_LIMIT = 3

function parseCode(code: string, publicKeyPem: string): LicensePayload | null {
  if (!publicKeyPem || !code.startsWith(LICENSE_CODE_PREFIX) || code.length > 16384) return null
  const parts = code.slice(LICENSE_CODE_PREFIX.length).split('.')
  const [body, signature] = parts
  if (parts.length !== 2 || !body || !signature) return null
  try {
    const canonical = Buffer.from(body, 'base64url')
    if (!verify(null, canonical, publicKeyPem, Buffer.from(signature, 'base64url'))) return null
    const obj = JSON.parse(canonical.toString('utf8')) as Partial<LicensePayload>
    if (typeof obj.customer !== 'string' || !obj.customer.trim() || typeof obj.issuedAt !== 'string' ||
        !Number.isFinite(Date.parse(obj.issuedAt)) ||
        (obj.expiresAt != null && (typeof obj.expiresAt !== 'string' || !Number.isFinite(Date.parse(obj.expiresAt)))) ||
        (obj.machine != null && (typeof obj.machine !== 'string' || !obj.machine.trim()))) return null
    return {
      customer: obj.customer, issuedAt: obj.issuedAt, expiresAt: obj.expiresAt ?? null, machine: obj.machine ?? null,
      // v1.3: 保留版本/特征位（parseCode 曾丢弃，导致 hasFeature 恒 false、LAN 主机永不启动）
      edition: obj.edition, features: obj.features, maxDevices: obj.maxDevices
    }
  } catch {
    return null
  }
}

interface LicenseOptions {
  now?: () => number
  machine?: () => string | undefined
  activationUrl?: string
  fetchImpl?: typeof fetch
}

export function createLicenseService(db: Database, publicKeyPem = '', options: LicenseOptions = {}) {
  const now = options.now ?? Date.now
  let rollbackActive = false
  const read = db.prepare('SELECT value FROM app_setting WHERE key = ?').pluck()
  const write = db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)')
  const get = (key: string) => read.get(`license.${key}`) as string | undefined
  const set = (key: string, value: string) => write.run(`license.${key}`, value)
  const verifyFormat = (code: string) => parseCode(code, publicKeyPem)

  const observeClock = db.transaction(() => {
    const time = now()
    if (!get('install_id')) set('install_id', randomUUID())
    if (!get('start')) set('start', new Date(time).toISOString())
    const start = Date.parse(get('start') ?? '')
    const previous = Number(get('last_seen')) || start || time
    const effectiveTime = Math.max(time, previous)
    let rollbacks = Number(get('rollback_count')) || 0
    if (time < previous - ROLLBACK_TOLERANCE_MS) {
      if (!rollbackActive) {
        rollbacks++
        set('rollback_count', String(rollbacks))
        rollbackActive = true
      }
    } else if (time >= previous) {
      rollbackActive = false
    }
    // Bound write amplification because the IPC guard checks every request.
    if (!get('last_seen') || effectiveTime - previous >= 60_000) set('last_seen', String(effectiveTime))
    return { effectiveTime, start, rollbacks }
  })

  function invalidReason(payload: LicensePayload, time: number): string | undefined {
    if (payload.expiresAt && Date.parse(payload.expiresAt) <= time) return '授权已过期'
    if (payload.machine && payload.machine !== options.machine?.()) return '激活码与本机设备不匹配'
    return undefined
  }

  function getStatus(): LicenseStatus {
    const { effectiveTime, start, rollbacks } = observeClock()
    // 已激活：永远可用，不受 7 天试用限制（早于计时判定返回）。
    const payload = verifyFormat(get('code') ?? '')
    if (payload && !invalidReason(payload, effectiveTime)) {
      return { mode: 'licensed', phase: 'activated', activatedAt: get('activated_at'), customer: payload.customer }
    }
    const elapsed = Math.max(0, Math.floor((effectiveTime - start) / DAY_MS))
    if (rollbacks >= ROLLBACK_LIMIT || !Number.isFinite(start)) {
      return { mode: 'trial', phase: 'expired', daysLeft: 0 }
    }
    // 试用状态机：7 天全功能试用；第 7 天起 expired 只读（无延期）。
    const daysLeft = Math.max(0, TRIAL_DAYS - elapsed)
    const phase: TrialPhase = daysLeft > 0 ? 'trial' : 'expired'
    return { mode: 'trial', phase, daysLeft }
  }

  function activate(code: string): LicensePayload {
    if (!publicKeyPem) throw new BizError('LICENSE_INVALID', '软件尚未配置授权公钥')
    const payload = verifyFormat(code)
    if (!payload) throw new BizError('LICENSE_INVALID', '激活码无效')
    const { effectiveTime } = observeClock()
    const reason = invalidReason(payload, effectiveTime)
    if (reason) throw new BizError('LICENSE_INVALID', reason)
    db.transaction(() => {
      set('code', code)
      set('activated_at', new Date(effectiveTime).toISOString())
    })()
    return payload
  }

  async function activateOnline(code: string): Promise<LicensePayload> {
    if (!options.activationUrl || !publicKeyPem) throw new BizError('LICENSE_INVALID', '软件尚未配置在线激活')
    if (!code || code.length > 256) throw new BizError('LICENSE_INVALID', '请输入有效的兑换码')
    const machine = options.machine?.()
    if (!machine) throw new BizError('LICENSE_INVALID', '无法获取本机设备信息')
    let token: unknown
    try {
      const url = new URL(options.activationUrl)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid activation URL')
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, machine }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error'
      })
      if (response.status === 409) throw new BizError('LICENSE_INVALID', '兑换码已绑定其他设备，请联系供应商解绑')
      if (response.status === 404 || response.status === 400) throw new BizError('LICENSE_INVALID', '兑换码无效或已过期')
      if (!response.ok) throw new Error('activation unavailable')
      token = (await response.json() as { code?: unknown }).code
    } catch (e) {
      if (e instanceof BizError) throw e
      throw new BizError('LICENSE_INVALID', '无法连接激活服务，请稍后重试')
    }
    if (typeof token !== 'string' || verifyFormat(token)?.machine !== machine) {
      throw new BizError('LICENSE_INVALID', '服务器未返回本机设备的有效授权')
    }
    return activate(token)
  }

  return { verifyFormat, getStatus, activate, activateOnline }
}

export type LicenseService = ReturnType<typeof createLicenseService>
