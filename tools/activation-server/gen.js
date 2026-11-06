#!/usr/bin/env node
// Generate a license code: node gen.js "客户名" [days]
import { sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const [customer, daysArg] = process.argv.slice(2)
if (!customer) {
  console.error('usage: node gen.js "客户名" [days]')
  process.exit(1)
}
const privateKey = readFileSync(join(__dirname, 'private.pem'), 'utf8')
const days = Number(daysArg)
const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null
const payload = { customer, issuedAt: new Date().toISOString(), expiresAt, machine: null }
const canonical = JSON.stringify(payload)
const sig = sign(null, Buffer.from(canonical, 'utf8'), privateKey)
const code = `ZHJS1.${Buffer.from(canonical).toString('base64url')}.${sig.toString('base64url')}`
console.log(code)
