import { call } from './call'

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  daysLeft?: number
  activatedAt?: string
  customer?: string
  onlineAvailable?: boolean
}

export const licenseApi = {
  check: () => call<LicenseStatus>('license:check'),
  activate: (code: string) => call<LicensePayload>('license:activate', code),
  activateOnline: (code: string) => call<LicensePayload>('license:activateOnline', code)
}

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}
