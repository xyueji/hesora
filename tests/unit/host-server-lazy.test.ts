// v1.3 Task 5: 懒加载验收（T10 关注点）——无 lan_collaboration feature 时不加载 fastify。
// ESM 无 require.cache 可查，采用「源码静态断言」：index.ts 中 fastify 相关 import 必须
// 全部位于动态 import() 之内（即 await import('./host/server') 的懒加载路径），不存在
// 顶层静态 import fastify / ws / @peculiar/x509。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('host server lazy loading (T10 acceptance)', () => {
  it('index.ts has no top-level static import of fastify/ws/x509 — only dynamic import inside feature gate', () => {
    const src = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8')
    for (const pkg of ['fastify', "'ws'", '@peculiar/x509', 'host/server', 'host/gateway', 'host/pairing', 'host/auth']) {
      // 静态 import 形如 `from 'fastify'` / `from './host/server'`；动态形如 `import('...')`
      const staticImport = new RegExp(`from ['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
      expect(staticImport.test(src), `index.ts must not statically import ${pkg}`).toBe(false)
      // 且动态 import 确实存在（懒加载路径在）
      if (pkg === 'host/server') expect(src.includes("import('./host/server')")).toBe(true)
    }
    // feature gate 在动态 import 之前
    const gateIdx = src.indexOf("hasFeature(licensePayload, 'lan_collaboration')")
    const dynIdx = src.indexOf("import('./host/server')")
    expect(gateIdx).toBeGreaterThan(-1)
    expect(dynIdx).toBeGreaterThan(gateIdx)
  })
  it('server.ts keeps heavy deps (fastify/ws) static — they load only via dynamic import of server.ts', () => {
    const src = readFileSync(join(__dirname, '../../src/main/host/server.ts'), 'utf8')
    expect(src.includes("from 'fastify'")).toBe(true)
    expect(src.includes("from 'ws'")).toBe(true)
  })
})
