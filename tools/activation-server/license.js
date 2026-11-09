import { createHash, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export function openLicenses() {
  const db = new DatabaseSync(process.env.HESORA_LICENSE_DB || './licenses.db')
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS redemption (
      code_hash TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      expires_at TEXT,
      machine TEXT
    )`)
  return db
}

export function hashCode(code) {
  return createHash('sha256').update(code).digest('hex')
}

export function readPrivateKey() {
  const path = process.env.HESORA_LICENSE_PRIVATE_KEY_FILE
  if (!path) throw new Error('Set HESORA_LICENSE_PRIVATE_KEY_FILE to the external signing key path')
  return readFileSync(path, 'utf8')
}

export function generateCode({ customer, expiresAt = null, machine = null, edition = null, features = null, maxDevices = null }, privateKey) {
  const body = Buffer.from(JSON.stringify({ customer, issuedAt: new Date().toISOString(), expiresAt, machine, edition, features, maxDevices }))
  return `ZHJS1.${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`
}
