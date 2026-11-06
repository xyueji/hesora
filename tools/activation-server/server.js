// Activation server (offline Ed25519 license issuance). No deps; node:http only.
// Reads private.pem from this directory. POST /api/activate {customer, expiresAt?, machine?}
// → { code }. GET /health → { ok: true }.
import { sign } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const privateKey = readFileSync(join(__dirname, 'private.pem'), 'utf8')

function generateCode(payload: { customer: string; issuedAt: string; expiresAt: string | null; machine: string | null }): string {
  const canonical = JSON.stringify(payload)
  const sig = sign(null, Buffer.from(canonical, 'utf8'), privateKey)
  return `ZHJS1.${Buffer.from(canonical).toString('base64url')}.${sig.toString('base64url')}`
}

interface ActivateBody {
  customer?: string
  expiresAt?: string | null
  machine?: string | null
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (req.method === 'POST' && req.url === '/api/activate') {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
      if (body.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as ActivateBody
        if (!parsed.customer || typeof parsed.customer !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'customer required' }))
          return
        }
        const code = generateCode({
            customer: parsed.customer,
            issuedAt: new Date().toISOString(),
            expiresAt: parsed.expiresAt ?? null,
            machine: parsed.machine ?? null
          })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code }))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad request' }))
      }
    })
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

const port = Number(process.env['PORT'] || 7799)
server.listen(port, () => {
  console.log(`activation server listening on :${port}`)
})
