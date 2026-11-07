import { sign } from 'node:crypto'

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}

export const LICENSE_CODE_PREFIX = 'ZHJS1.'
export const TRIAL_DAYS = 15

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

/**
 * Generate a license code. Used ONLY by the activation server CLI and tests —
 * the app itself only verifies.
 */
export function generateLicenseCode(payload: LicensePayload, privateKeyPem: string): string {
  const canonical = JSON.stringify(payload)
  const sig = sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem)
  return `${LICENSE_CODE_PREFIX}${b64url(canonical)}.${b64url(sig)}`
}
