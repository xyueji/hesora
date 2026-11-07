// 零依赖 WebDAV 客户端（Node fetch 实现）。仅覆盖备份同步所需的最小操作。
export interface DavResponse {
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

function authHeader(username: string, password: string): string | null {
  if (!username && !password) return null
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function headers(username: string, password: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const auth = authHeader(username, password)
  if (auth) h['Authorization'] = auth
  return h
}

export async function webdavPut(
  url: string,
  body: Buffer,
  username = '',
  password = ''
): Promise<DavResponse> {
  const res = await fetch(url, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: headers(username, password, { 'Content-Type': 'application/octet-stream' }),
    body: new Uint8Array(body)
  })
  return { ok: res.ok, status: res.status, arrayBuffer: () => res.arrayBuffer() }
}

export async function webdavGet(url: string, username = '', password = ''): Promise<DavResponse> {
  const res = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: headers(username, password) })
  return { ok: res.ok, status: res.status, arrayBuffer: () => res.arrayBuffer() }
}

export async function webdavMkcol(url: string, username = '', password = ''): Promise<DavResponse> {
  const res = await fetch(url, { method: 'MKCOL', redirect: 'error', signal: AbortSignal.timeout(30000), headers: headers(username, password) })
  return { ok: res.ok || res.status === 405, status: res.status, arrayBuffer: () => res.arrayBuffer() }
}

export async function webdavPropfind(url: string, username = '', password = ''): Promise<DavResponse> {
  const res = await fetch(url, {
    method: 'PROPFIND',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: headers(username, password, { Depth: '0' })
  })
  return { ok: res.ok, status: res.status, arrayBuffer: () => res.arrayBuffer() }
}

/** Join a base dir URL and a filename, ensuring exactly one slash between them. */
export function davJoin(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}
