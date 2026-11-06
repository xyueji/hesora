import { sign } from 'node:crypto'

// Ed25519 public key embedded in the app. The matching private key lives in
// tools/activation-server/private.pem (activation server / gen CLI only).
// NOTE: private key is committed to the repo for now (dev convenience) — must be
// removed before release builds.
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAz7Th3fNP37RnbhW7o7yieZWW1GLW1Qyw0BF0ohBYDME=
-----END PUBLIC KEY-----`

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
