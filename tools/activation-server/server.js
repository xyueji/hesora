import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { generateCode, hashCode, openLicenses, readPrivateKey } from './license.js'

const key = readPrivateKey()
const db = openLicenses()
const adminToken = process.env.HESORA_LICENSE_ADMIN_TOKEN
const tokenHash = (value) => createHash('sha256').update(value).digest()

function respond(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4096) throw new Error('body too large')
    parts.push(chunk)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true })
  if (req.method !== 'POST' || !['/api/activate', '/api/unbind'].includes(req.url)) {
    return respond(res, 404, { error: 'not found' })
  }
  if (req.url === '/api/unbind' && (!adminToken || !timingSafeEqual(
    tokenHash(req.headers.authorization || ''), tokenHash(`Bearer ${adminToken}`)
  ))) return respond(res, 403, { error: 'forbidden' })

  let body
  try {
    body = await readBody(req)
  } catch {
    return respond(res, 400, { error: 'invalid request' })
  }

  if (typeof body?.code !== 'string' || !/^HSR-[a-f0-9]{48}$/.test(body.code)) {
    return respond(res, 400, { error: 'invalid code' })
  }

  const hash = hashCode(body.code)
  if (req.url === '/api/unbind') {
    const result = db.prepare('UPDATE redemption SET machine = NULL WHERE code_hash = ?').run(hash)
    return respond(res, result.changes ? 200 : 404, { ok: Boolean(result.changes) })
  }
  if (typeof body.machine !== 'string' || !/^[a-f0-9]{64}$/.test(body.machine)) {
    return respond(res, 400, { error: 'invalid machine' })
  }

  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const license = db.prepare('SELECT * FROM redemption WHERE code_hash = ?').get(hash)
      if (!license || (license.expires_at && Date.parse(license.expires_at) <= Date.now())) {
        db.exec('ROLLBACK')
        return respond(res, 404, { error: 'code unavailable' })
      }
      if (license.machine && license.machine !== body.machine) {
        db.exec('ROLLBACK')
        return respond(res, 409, { error: 'code already bound' })
      }
      const code = generateCode({ customer: license.customer, expiresAt: license.expires_at, machine: body.machine }, key)
      db.prepare('UPDATE redemption SET machine = ? WHERE code_hash = ?').run(body.machine, hash)
      db.exec('COMMIT')
      return respond(res, 200, { code })
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } catch {
    return respond(res, 500, { error: 'activation unavailable' })
  }
})

const port = Number(process.env.PORT || 7799)
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Activation service listening on port ${port}`)
})
