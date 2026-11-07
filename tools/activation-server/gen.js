#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { generateCode, hashCode, openLicenses, readPrivateKey } from './license.js'

const args = process.argv.slice(2)
const mode = args.shift()
const [customer, daysArg] = args
const days = daysArg === undefined ? 0 : Number(daysArg)
if (!['--redeem', '--offline'].includes(mode) || !customer?.trim() ||
    !Number.isSafeInteger(days) || days < 0 || days > 36500) {
  console.error('Usage: node gen.js --redeem|--offline "customer" [days]')
  process.exit(1)
}
const expiresAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
if (mode === '--offline') {
  console.log(generateCode({ customer, expiresAt }, readPrivateKey()))
} else {
  const db = openLicenses()
  const code = `HSR-${randomBytes(24).toString('hex')}`
  db.prepare('INSERT INTO redemption (code_hash, customer, expires_at) VALUES (?, ?, ?)').run(hashCode(code), customer, expiresAt)
  db.close()
  console.log(code)
}
