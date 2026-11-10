import { describe, it, expect } from 'vitest'
import {
  createUpdateService,
  isNewerVersion,
  resolveDownloadUrl,
  DEFAULT_FETCH_INIT,
  DEFAULT_FIXED_ASSET,
  DEFAULT_RELEASE_BASE_URL,
  UPDATE_PACKAGE_NAME,
  type FetchLike,
  type FetchLikeResponse
} from '../../src/main/services/update/update.service'

const GITEE_URL = 'https://gitee.com/<owner>/<repo>/raw/main/latest.json'
const GITHUB_URL = 'https://raw.githubusercontent.com/<owner>/<repo>/main/latest.json'
const VALID_SHA256 = 'a'.repeat(64)

function okFetcher(json: string): FetchLike {
  return async () => ({ ok: true, status: 200, text: async () => json })
}

function okResponse(json: string): FetchLikeResponse {
  return { ok: true, status: 200, text: async () => json }
}

function notOkResponse(): FetchLikeResponse {
  return { ok: false, status: 503, text: async () => '' }
}

describe('update.service — legacy single-URL cases', () => {
  it('detects newer version with fields passed through', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'https://x/latest.json',
      allowHosts: ['x'],
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
      updateUrl: GITEE_URL,
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
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher(JSON.stringify({ version: '1.10.0' }))
    })
    expect((await svc.check()).hasUpdate).toBe(true)
  })

  it('rejects an insecure manifest download link (http)', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: 'https://x/latest.json',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url: 'http://x/dl.exe' }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })
})

describe('isNewerVersion', () => {
  it('pads missing segments and compares numerically', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0', '1.0.0.0')).toBe(false)
    expect(isNewerVersion('1.10.0', '1.9.10')).toBe(true)
    expect(isNewerVersion('2.0', '1.9.9')).toBe(true)
  })
})

describe('update.service — multi-channel semantics', () => {
  const urls = [GITEE_URL, GITHUB_URL]

  it('Gitee success does NOT fall back to GitHub (fetcher called once)', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      return okResponse(
        JSON.stringify({
          version: '1.1.0',
          notes: '来自 Gitee',
          url: 'https://github.com/<owner>/<repo>/releases/download/v1.1.0/setup.exe',
          sha256: VALID_SHA256
        })
      )
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(calls).toBe(1)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('gitee')
    expect(r.notes).toBe('来自 Gitee')
    expect(r.sha256).toBe(VALID_SHA256)
  })

  it('Gitee network failure → GitHub success', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u)
      if (u === GITEE_URL) throw new Error('ECONNREFUSED')
      return okResponse(
        JSON.stringify({ version: '2.0.0', url: 'https://github.com/<owner>/<repo>/releases/download/v2/setup.exe' })
      )
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(seen).toEqual([GITEE_URL, GITHUB_URL])
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('github')
    expect(r.latestVersion).toBe('2.0.0')
  })

  it('Gitee non-2xx (503) → GitHub success', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return notOkResponse()
      return okResponse(JSON.stringify({ version: '2.1.0' }))
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(calls).toBe(2)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('github')
  })

  it('Gitee valid but no update → does NOT fall back to GitHub', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return okResponse(JSON.stringify({ version: '1.0.0' }))
      return okResponse(JSON.stringify({ version: '9.9.9' }))
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(calls).toBe(1)
    expect(r).toEqual({ hasUpdate: false })
  })

  it('Gitee valid but older → does NOT fall back to GitHub', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return okResponse(JSON.stringify({ version: '0.9.0' }))
      return okResponse(JSON.stringify({ version: '9.9.9' }))
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(calls).toBe(1)
    expect(r).toEqual({ hasUpdate: false })
  })

  it('Gitee invalid JSON → GitHub success', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return okResponse('{ broken json')
      return okResponse(JSON.stringify({ version: '3.0.0' }))
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(calls).toBe(2)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('github')
  })

  it('both channels fail → hasUpdate false, never throws', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down')
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: urls, fetchImpl }).check()
    expect(r).toEqual({ hasUpdate: false })
  })

  it('no URLs configured → hasUpdate false, fetcher never called', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      return okResponse(JSON.stringify({ version: '9.9.9' }))
    }
    const r = await createUpdateService({ currentVersion: '1.0.0', updateUrls: [], fetchImpl }).check()
    expect(calls).toBe(0)
    expect(r).toEqual({ hasUpdate: false })
  })

  it('updateUrl (legacy) is equivalent to [updateUrl]', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u)
      return okResponse(JSON.stringify({ version: '1.2.0' }))
    }
    const single = await createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: GITEE_URL,
      fetchImpl
    }).check()
    expect(seen).toEqual([GITEE_URL])
    expect(single.hasUpdate).toBe(true)
    expect(single.source).toBe('gitee')
  })

  it('updateUrls takes precedence over legacy updateUrl when both set', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u)
      return okResponse(JSON.stringify({ version: '1.2.0' }))
    }
    const r = await createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: GITEE_URL,
      updateUrls: [GITHUB_URL],
      fetchImpl
    }).check()
    expect(seen).toEqual([GITHUB_URL])
    expect(r.source).toBe('github')
  })
})

describe('update.service — download URL whitelist', () => {
  const currentVersion = '1.0.0'

  it('rejects downloadUrl on a non-whitelisted domain and falls back to next channel', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) {
        return okResponse(JSON.stringify({ version: '1.1.0', url: 'https://evil.example.com/setup.exe' }))
      }
      return okResponse(
        JSON.stringify({ version: '1.1.0', url: 'https://github.com/<owner>/<repo>/releases/download/v1/setup.exe' })
      )
    }
    const r = await createUpdateService({
      currentVersion,
      updateUrls: [GITEE_URL, GITHUB_URL],
      fetchImpl
    }).check()
    expect(calls).toBe(2)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('github')
  })

  it('accepts github.com / raw.githubusercontent.com / gitee.com / gitee.io hosts', async () => {
    const hosts = [
      'https://github.com/o/r/releases/download/v1/setup.exe',
      'https://raw.githubusercontent.com/o/r/main/setup.exe',
      'https://objects.githubusercontent.com/o/r/setup.exe',
      'https://gitee.com/o/r/releases/download/v1/setup.exe',
      'https://o.gitee.io/setup.exe'
    ]
    for (const url of hosts) {
      const svc = createUpdateService({
        currentVersion,
        updateUrl: 'https://gitee.com/o/r/raw/main/latest.json',
        fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url }))
      })
      expect((await svc.check()).downloadUrl, url).toBe(url)
    }
  })

  it('rejects credentialed https download url', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: 'https://gitee.com/o/r/raw/main/latest.json',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url: 'https://user:pw@github.com/o/r/setup.exe' }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })

  it('rejects a tampered lookalike host', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: 'https://gitee.com/o/r/raw/main/latest.json',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url: 'https://github.com.evil.io/setup.exe' }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })

  it('accepts foruda.gitee.com (Gitee release attachment CDN) and github.io', async () => {
    const hosts = [
      'https://foruda.gitee.com/attach_file/123/setup.exe?v=1',
      'https://o.github.io/setup.exe'
    ]
    for (const url of hosts) {
      const svc = createUpdateService({
        currentVersion,
        updateUrl: 'https://gitee.com/o/r/raw/main/latest.json',
        fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url }))
      })
      expect((await svc.check()).downloadUrl, url).toBe(url)
    }
  })

  it('custom allowHosts overrides the built-in whitelist', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: 'https://updates.example.com/latest.json',
      allowHosts: ['updates.example.com'],
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url: 'https://updates.example.com/setup.exe' }))
    })
    expect((await svc.check()).downloadUrl).toBe('https://updates.example.com/setup.exe')
  })

  it('rejects an invalid (non-https) manifest URL as a failed channel', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      return okResponse(JSON.stringify({ version: '9.9.9' }))
    }
    const r = await createUpdateService({
      currentVersion,
      updateUrls: ['http://gitee.com/o/r/raw/main/latest.json', GITHUB_URL],
      fetchImpl
    }).check()
    expect(calls).toBe(1)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('github')
  })
})

describe('update.service — Gitee raw redirect (P0)', () => {
  it('DEFAULT_FETCH_INIT follows redirects (never error) so Gitee raw 302 works', () => {
    expect(DEFAULT_FETCH_INIT.redirect).toBe('follow')
    expect(DEFAULT_FETCH_INIT.signal).toBeDefined()
  })

  it('accepts raw.giteeusercontent.com / *.giteeusercontent.com as download hosts', async () => {
    const hosts = [
      'https://raw.giteeusercontent.com/o/r/raw/main/latest.json',
      'https://cdn.giteeusercontent.com/o/r/setup.exe'
    ]
    for (const url of hosts) {
      const svc = createUpdateService({
        currentVersion: '1.0.0',
        updateUrl: GITEE_URL,
        fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', url }))
      })
      expect((await svc.check()).downloadUrl, url).toBe(url)
    }
  })

  it('simulates Gitee raw 302 → raw.giteeusercontent.com and still reports update', async () => {
    // 模拟 fetch 内部跟随 302 后的最终响应（FetchLike 抽象只暴露最终 ok/text）。
    let seen: string | undefined
    const fetchImpl: FetchLike = async (u) => {
      seen = u
      // 客户端注入的 fetch 使用 redirect:'follow'，Gitee 的 302 由运行时透明跟随，
      // 这里直接返回跟随后的 200 JSON，模拟真实链路结果。
      return okResponse(JSON.stringify({ version: '1.1.0', sha256: VALID_SHA256 }))
    }
    const r = await createUpdateService({
      currentVersion: '1.0.0',
      updateUrls: [GITEE_URL, GITHUB_URL],
      fetchImpl
    }).check()
    expect(seen).toBe(GITEE_URL)
    expect(r.hasUpdate).toBe(true)
    expect(r.source).toBe('gitee')
  })
})

describe('resolveDownloadUrl — fixed tag / package contract', () => {
  it('returns the explicit manifest url unchanged when provided', () => {
    const url = 'https://github.com/o/r/releases/download/v1/setup.exe'
    expect(resolveDownloadUrl(url)).toBe(url)
  })

  it('treats empty/whitespace url as absent and uses the default fixed asset', () => {
    expect(resolveDownloadUrl(undefined)).toBe(`${DEFAULT_RELEASE_BASE_URL}/${UPDATE_PACKAGE_NAME}`)
    expect(resolveDownloadUrl('   ')).toBe(`${DEFAULT_RELEASE_BASE_URL}/${UPDATE_PACKAGE_NAME}`)
  })

  it('default fixed asset encodes tag=latest and the stable package name', () => {
    expect(DEFAULT_FIXED_ASSET.packageName).toBe('hesora-inventory-setup.exe')
    expect(DEFAULT_RELEASE_BASE_URL).toBe('https://gitee.com/xyueji/hesora/releases/download/latest')
  })

  it('honors a custom FixedAssetConfig and trims trailing slashes', () => {
    expect(
      resolveDownloadUrl(undefined, {
        releaseBaseUrl: 'https://gitee.com/acme/app/releases/download/latest///',
        packageName: 'setup.exe'
      })
    ).toBe('https://gitee.com/acme/app/releases/download/latest/setup.exe')
  })

  it('service uses fixedAsset option when manifest.url is absent', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: GITEE_URL,
      fixedAsset: {
        releaseBaseUrl: 'https://gitee.com/acme/app/releases/download/latest',
        packageName: 'custom.exe'
      },
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0' }))
    })
    const r = await svc.check()
    expect(r.hasUpdate).toBe(true)
    expect(r.downloadUrl).toBe('https://gitee.com/acme/app/releases/download/latest/custom.exe')
  })

  it('fixed download URL must still pass the whitelist (custom allowHosts rejects it)', async () => {
    const svc = createUpdateService({
      currentVersion: '1.0.0',
      updateUrl: GITEE_URL,
      allowHosts: ['github.com'],
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0' }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })
})

describe('update.service — manifest field validation', () => {
  const currentVersion = '1.0.0'

  it('invalid sha256 → reject that channel, fall back to GitHub', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return okResponse(JSON.stringify({ version: '1.1.0', sha256: 'deadbeef' }))
      return okResponse(JSON.stringify({ version: '1.1.0', sha256: VALID_SHA256 }))
    }
    const r = await createUpdateService({
      currentVersion,
      updateUrls: [GITEE_URL, GITHUB_URL],
      fetchImpl
    }).check()
    expect(calls).toBe(2)
    expect(r.hasUpdate).toBe(true)
    expect(r.sha256).toBe(VALID_SHA256)
  })

  it('sha256 wrong type → reject that channel', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', sha256: 12345 }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })

  it('invalid version (letters) → reject that channel, fall back', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      if (calls === 1) return okResponse(JSON.stringify({ version: 'v1.1.0' }))
      return okResponse(JSON.stringify({ version: '1.1.0' }))
    }
    const r = await createUpdateService({
      currentVersion,
      updateUrls: [GITEE_URL, GITHUB_URL],
      fetchImpl
    }).check()
    expect(calls).toBe(2)
    expect(r.hasUpdate).toBe(true)
  })

  it('notes wrong type → reject that channel', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', notes: 42 }))
    })
    expect(await svc.check()).toEqual({ hasUpdate: false })
  })

  it('url absent → resolves to fixed tag/package download URL', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0', notes: '仅公告' }))
    })
    const r = await svc.check()
    expect(r.hasUpdate).toBe(true)
    expect(r.downloadUrl).toBe(
      'https://gitee.com/xyueji/hesora/releases/download/latest/hesora-inventory-setup.exe'
    )
  })

  it('JSON array / null → reject that channel', async () => {
    const arr = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher('[]')
    })
    expect(await arr.check()).toEqual({ hasUpdate: false })
    const nul = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher('null')
    })
    expect(await nul.check()).toEqual({ hasUpdate: false })
  })

  it('source is custom for a non-gitee/github manifest host', async () => {
    const svc = createUpdateService({
      currentVersion,
      updateUrl: 'https://updates.example.com/latest.json',
      allowHosts: ['updates.example.com'],
      fetchImpl: okFetcher(
        JSON.stringify({ version: '1.1.0', url: 'https://updates.example.com/setup.exe' })
      )
    })
    expect((await svc.check()).source).toBe('custom')
  })

  it('source is gitee / github by manifest host', async () => {
    const gitee = createUpdateService({
      currentVersion,
      updateUrl: GITEE_URL,
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0' }))
    })
    expect((await gitee.check()).source).toBe('gitee')
    const github = createUpdateService({
      currentVersion,
      updateUrl: 'https://github.com/<owner>/<repo>/raw/main/latest.json',
      fetchImpl: okFetcher(JSON.stringify({ version: '1.1.0' }))
    })
    expect((await github.check()).source).toBe('github')
  })
})
