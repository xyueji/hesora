import { describe, it, expect } from 'vitest'
import { createUpdateService } from '../../src/main/services/update/update.service'

function okFetcher(json: string) {
  return async () => ({ ok: true, status: 200, text: async () => json })
}

describe('update.service', () => {
  it('detects newer version with fields passed through', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'https://x/latest.json',
      fetchImpl: okFetcher(
        JSON.stringify({ version: '1.1.0', notes: '修复若干问题', url: 'https://x/dl.exe' })
      )
    })
    const r = await svc.check()
    expect(r.hasUpdate).toBe(true)
    expect(r.latestVersion).toBe('1.1.0')
    expect(r.notes).toBe('修复若干问题')
    expect(r.downloadUrl).toBe('https://x/dl.exe')
  })

  it('no update when equal version', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'u',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.0.0' }))
    })
    expect((await svc.check()).hasUpdate).toBe(false)
  })

  it('no update when remote older', async () => {
    const svc = createUpdateService({
      currentVersion: '1.2.0',
      updateUrl: 'u',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.9' }))
    })
    expect((await svc.check()).hasUpdate).toBe(false)
  })

  it('network failure returns hasUpdate false, never throws', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'u',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      }
    })
    const r = await svc.check()
    expect(r).toEqual({ hasUpdate: false })
  })

  it('invalid JSON returns hasUpdate false', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'u',
      fetchImpl: okFetcher('not json {')
    })
    expect((await svc.check()).hasUpdate).toBe(false)
  })

  it('compares major/minor/patch numerically', async () => {
    const svc = createUpdateService({
      currentVersion: '1.9.10',
      updateUrl: 'u',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.10.0' }))
    })
    expect((await svc.check()).hasUpdate).toBe(true)
  })
})

it('rejects an insecure manifest download link', async () => {
  const svc = createUpdateService({
    currentVersion: '1.0.0',
    updateUrl: 'https://x/latest.json',
    fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url: 'http://x/dl.exe' }))
  })
  expect(await svc.check()).toEqual({ hasUpdate: false })
})
