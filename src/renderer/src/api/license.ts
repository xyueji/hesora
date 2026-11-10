import { call } from './call'

export type TrialPhase = 'trial' | 'expired' | 'activated'

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  /** 试用阶段：trial(1-7天，全功能)/expired(只读)/activated(已激活)。 */
  phase: TrialPhase
  daysLeft?: number
  activatedAt?: string
  customer?: string
  onlineAvailable?: boolean
}

export const licenseApi = {
  check: () => call<LicenseStatus>('license:check'),
  activate: (code: string) => call<LicensePayload>('license:activate', code),
  activateOnline: (code: string) => call<LicensePayload>('license:activateOnline', code),
  /** 试用状态（同 check，语义化入口）。 */
  trialStatus: () => call<LicenseStatus>('trial:check'),
  /** 重置演示数据为初始演示态（不影响试用计时）。 */
  resetDemo: () => call<boolean>('trial:resetDemo')
}

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}
