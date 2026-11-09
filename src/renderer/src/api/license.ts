import { call } from './call'

export type TrialPhase = 'trial' | 'extended' | 'expired' | 'activated'

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  /** 试用阶段：trial(1-7天)/extended(8-14天)/expired(只读)/activated(已激活)。 */
  phase: TrialPhase
  daysLeft?: number
  /** 已使用一次 7 天延期。 */
  extended?: boolean
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
  /** 本地一键延期 7 天（仅一次），返回延期后的状态。 */
  extendTrial: () => call<LicenseStatus>('trial:extend'),
  /** 重置演示数据为初始演示态（不影响试用计时）。 */
  resetDemo: () => call<boolean>('trial:resetDemo')
}

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}
