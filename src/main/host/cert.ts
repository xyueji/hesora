// v1.3 Task 5: 主机自签 TLS 证书。
// 选 EC P-256 而非 RSA 2048：spec §5.3 明确 EC P-256；密钥更短、生成更快、
// 安全强度相当（~128bit），且 @peculiar/x509 对 ECDSA 签名支持成熟。
// 指纹 = sha256(证书 DER)，客户端 pinning 用（spec §5.3）。
import 'reflect-metadata'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, webcrypto } from 'node:crypto'
import { X509CertificateGenerator, BasicConstraintsExtension, type X509Certificate } from '@peculiar/x509'

export interface HostCertificate {
  certPem: string
  keyPem: string
  fingerprintHex: string
}

const CERT_FILE = 'host-cert.pem'
const KEY_FILE = 'host-key.pem'

/** 自签主机证书，CN=hx-host，有效期 10 年；已存在则读回，不重新生成（指纹必须跨重启稳定）。 */
export async function ensureHostCertificate(certDir: string): Promise<HostCertificate> {
  const certPath = join(certDir, CERT_FILE)
  const keyPath = join(certDir, KEY_FILE)
  if (existsSync(certPath) && existsSync(keyPath)) {
    const certPem = readFileSync(certPath, 'utf8')
    const keyPem = readFileSync(keyPath, 'utf8')
    return { certPem, keyPem, fingerprintHex: fingerprintOf(certPem) }
  }

  mkdirSync(certDir, { recursive: true })
  // Node KeyObject → WebCrypto CryptoKey（JWK 中转；@peculiar/x509 需要 SubtleCrypto 签名）
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pubJwk = publicKey.export({ format: 'jwk' }) as import('node:crypto').JsonWebKey
  const privJwk = privateKey.export({ format: 'jwk' }) as import('node:crypto').JsonWebKey
  const pubCrypto = await webcrypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
  const privCrypto = await webcrypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const now = new Date()
  const notAfter = new Date(now.getTime() + 10 * 365.25 * 24 * 3600 * 1000)
  const cert: X509Certificate = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: '01',
      name: 'CN=hx-host',
      notBefore: now,
      notAfter,
      keys: { publicKey: pubCrypto, privateKey: privCrypto },
      // CA=true 仅为自签合法所需（BasicConstraints）；当前只做服务端 TLS 证书
      extensions: [new BasicConstraintsExtension(true, 0, true)]
    },
    webcrypto as unknown as Parameters<typeof X509CertificateGenerator.createSelfSigned>[1]
  )
  const certPem = cert.toString('pem')
  // 私钥按 SEC1 PEM 落盘（Node export 原样；Windows 下 chmod 无效，实际保护
  // 依赖 certDir 所在目录 ACL——userData 仅当前用户可读，NTFS 继承 ACL 已满足）。
  const keyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()

  writeFileSync(certPath, certPem, { mode: 0o600 })
  writeFileSync(keyPath, keyPem, { mode: 0o600 })
  return { certPem, keyPem, fingerprintHex: fingerprintOf(certPem) }
}

function fingerprintOf(certPem: string): string {
  const der = Buffer.from(certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64')
  return createHash('sha256').update(der).digest('hex')
}
