const { createPublicKey } = require('node:crypto')

for (const key of ['HESORA_ACTIVATION_URL', 'HESORA_UPDATE_URL']) {
  let url
  try {
    url = new URL(process.env[key] || '')
  } catch {
    throw new Error(`${key} must be a production HTTPS URL.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      /(^|\.)(localhost|example\.(com|net|org))$/.test(url.hostname)) {
    throw new Error(`${key} must be a production HTTPS URL.`)
  }
}

let type
try {
  type = createPublicKey((process.env.HESORA_LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n')).asymmetricKeyType
} catch {
  throw new Error('HESORA_LICENSE_PUBLIC_KEY must contain the production Ed25519 public key.')
}
if (type !== 'ed25519') throw new Error('HESORA_LICENSE_PUBLIC_KEY must contain the production Ed25519 public key.')
