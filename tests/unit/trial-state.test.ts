import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { generateLicenseCode, TRIAL_DAYS, TRIAL_EXPIRED_BLOCKED_CHANNELS, isTrialExpiredWrite } from '../../src/shared/license'
import { createLicenseService } from '../../src/main/services/license/license.service'
import { openMemDb } from '../helpers/mem-db'
import { seedDemoData, resetDemoData } from '../../src/main/db/seed'

const DAY_MS = 24 * 60 * 60 * 1000

function makePair() {
  return generateKeyPairSync('ed25519')
}
const { publicKey, privateKey } = makePair()
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

// T0 = 首次启动时间；svc 以注入 clock 实现时间穿越。
const T0 = Date.parse('2026-11-01T08:00:00Z')

function makeSvc(now: () => number) {
  return createLicenseService(openMemDb(), pubPem, { now })
}

function daySvc(startOffsetDays: number) {
  let t = T0
  const svc = makeSvc(() => t)
  svc.getStatus() // 固化 license.start = T0
  t = T0 + startOffsetDays * DAY_MS
  return {
    svc,
    setDay: (d: number) => { t = T0 + d * DAY_MS }
  }
}

describe('trial state machine (7 天全功能试用，到期只读，无延期)', () => {
  it('第 0 天 phase=trial 且 daysLeft=TRIAL_DAYS', () => {
    const { svc } = daySvc(0)
    const s = svc.getStatus()
    expect(s.mode).toBe('trial')
    expect(s.phase).toBe('trial')
    expect(s.daysLeft).toBe(TRIAL_DAYS)
  })

  it('第 1-6 天 phase=trial 且 daysLeft 正确递减', () => {
    const { svc, setDay } = daySvc(0)
    for (const d of [1, 3, 6]) {
      setDay(d)
      const s = svc.getStatus()
      expect(s.phase).toBe('trial')
      expect(s.daysLeft).toBe(TRIAL_DAYS - d)
    }
  })

  it('第 7 天 → expired（daysLeft=0）', () => {
    const { svc, setDay } = daySvc(6)
    expect(svc.getStatus().phase).toBe('trial')
    setDay(7)
    const s = svc.getStatus()
    expect(s.phase).toBe('expired')
    expect(s.daysLeft).toBe(0)
  })

  it('第 7 天之后始终 expired，daysLeft 恒为 0', () => {
    const { svc, setDay } = daySvc(0)
    for (const d of [7, 10, 30]) {
      setDay(d)
      const s = svc.getStatus()
      expect(s.phase).toBe('expired')
      expect(s.daysLeft).toBe(0)
    }
  })

  it('激活后 phase=activated，不受 7 天限制（永远可用）', () => {
    const { svc, setDay } = daySvc(7)
    const code = generateLicenseCode({ customer: '客户甲', issuedAt: '2026-01-01T00:00:00Z' }, privPem)
    svc.activate(code)
    setDay(60)
    const s = svc.getStatus()
    expect(s.phase).toBe('activated')
    expect(s.mode).toBe('licensed')
    expect(s.customer).toBe('客户甲')
  })

  it('试用状态兼容字段：mode=trial + daysLeft（渲染层路由守卫沿用）', () => {
    const { svc, setDay } = daySvc(3)
    setDay(8)
    const s = svc.getStatus()
    expect(s.mode).toBe('trial')
    expect(s.daysLeft).toBe(0)
  })
})

describe('expired 拦截清单（shared，主进程 guard 使用）', () => {
  it('业务单据写通道全部在拦截清单内', () => {
    for (const ch of [
      'sale:create', 'sale:createReturn', 'purchase:create', 'purchase:createReturn',
      'retail:create', 'retail:hold', 'retail:discardHeld',
      'transfer:create', 'stocktake:create', 'stocktake:importSheet', 'stocktake:review',
      'assemble:create', 'assemble:disassemble',
      'payment:create', 'payment:createPayment', 'payment:createReceipt', 'payment:openDocuments',
      'ledger:transfer', 'doc:copy', 'doc:reverse', 'doc:review',
      'workflow:save', 'workflow:approve', 'workflow:convert', 'workflow:cancel',
      'serial:registerIn', 'serial:consumeOut', 'attachment:save', 'attachment:remove'
    ]) {
      expect(TRIAL_EXPIRED_BLOCKED_CHANNELS).toContain(ch)
    }
  })

  it('isTrialExpiredWrite：expired 拦业务写、放行查看/导出/备份/激活/主档', () => {
    expect(isTrialExpiredWrite('sale:create', 'expired', 0)).toBe(true)
    expect(isTrialExpiredWrite('doc:query', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('csv:export', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('backup:now', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('backup:restore', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('license:activate', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('product:create', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('customer:update', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('setting:set', 'expired', 0)).toBe(false)
    expect(isTrialExpiredWrite('trial:check', 'expired', 0)).toBe(false)
  })

  it('isTrialExpiredWrite：对 phase=trial / activated 一律放行', () => {
    expect(isTrialExpiredWrite('sale:create', 'trial', 3)).toBe(false)
    expect(isTrialExpiredWrite('sale:create', 'activated', undefined)).toBe(false)
  })
})

describe('演示数据重置（不影响试用计时）', () => {
  it('resetDemoData 清空业务数据并重灌演示态', () => {
    const db = openMemDb()
    expect(seedDemoData(db)).toBe(true)
    expect(resetDemoData(db)).toBe(true)
    const products = (db.prepare('SELECT COUNT(*) AS c FROM product').get() as { c: number }).c
    expect(products).toBe(12)
    const docs = (db.prepare('SELECT COUNT(*) AS c FROM doc').get() as { c: number }).c
    expect(docs).toBeGreaterThan(0)
  })

  it('resetDemoData 不清空 license.*（不重置计时）', () => {
    const db = openMemDb()
    let t = T0
    const svc = createLicenseService(db, pubPem, { now: () => t })
    svc.getStatus()
    t = T0 + 5 * DAY_MS
    expect(resetDemoData(db)).toBe(true)
    const start = db.prepare("SELECT value FROM app_setting WHERE key='license.start'").pluck().get() as string
    expect(Date.parse(start)).toBe(T0)
    // 状态机延续：重置后仍是 trial 阶段（第 5 天）
    expect(svc.getStatus().phase).toBe('trial')
    expect(svc.getStatus().daysLeft).toBe(TRIAL_DAYS - 5)
  })

  it('resetDemoData 保留 platform_log 审计记录', () => {
    const db = openMemDb()
    seedDemoData(db)
    db.prepare("INSERT INTO platform_log (action, operator, detail, before_value, after_value, created_at) VALUES ('x','a','d',NULL,NULL,'2026-01-01')").run()
    resetDemoData(db)
    expect((db.prepare('SELECT COUNT(*) AS c FROM platform_log').get() as { c: number }).c).toBe(1)
  })
})
