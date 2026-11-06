import type { Result } from '../../../shared/result'

export interface LicenseStatus {
  mode: 'trial' | 'licensed'
  daysLeft?: number
  activatedAt?: string
  customer?: string
}

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const licenseApi = {
  check: () => call<LicenseStatus>('license:check'),
  activate: (code: string) => call<LicensePayload>('license:activate', code)
}

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}
