import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSplashWindow, closeSplashWindow } from '../../src/main/splash'

// 回归测试（v1.4 真机 bug）：splash 设置了 closable:false，Windows/Electron 下
// 对 closable:false 的窗口调用 close() 是 no-op，会残留一个 alwaysOnTop 置顶窗。
// 因此 closeSplashWindow() 必须用 destroy()，不能用 close()。
const h = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/proj' },
  instances: [] as Array<{
    opts: Record<string, unknown>
    destroyed: boolean
    isDestroyed(): boolean
    destroy: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    opts: Record<string, unknown>
    destroyed = false
    close = vi.fn()
    destroy = vi.fn(() => { this.destroyed = true })
    loadFile = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined)
    isDestroyed() { return this.destroyed }
    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      h.instances.push(this)
    }
  }
  return { app: h.app, BrowserWindow: FakeBrowserWindow }
})

beforeEach(() => { h.instances.length = 0 })

describe('splash window', () => {
  it('creates a non-closable alwaysOnTop frameless window', () => {
    const win = createSplashWindow()
    expect(h.instances[0]!.opts).toMatchObject({
      closable: false,
      alwaysOnTop: true,
      frame: false,
      show: true,
      resizable: false
    })
    closeSplashWindow(win)
  })

  it('closeSplashWindow uses destroy() (NOT close()) so closable:false cannot leave a stuck window', () => {
    const win = createSplashWindow()
    const inst = h.instances[0]!
    closeSplashWindow(win)
    expect(inst.destroy).toHaveBeenCalledOnce()
    expect(inst.close).not.toHaveBeenCalled()
    expect(inst.isDestroyed()).toBe(true)
  })

  it('closeSplashWindow is idempotent and null/undefined-safe', () => {
    const win = createSplashWindow()
    const inst = h.instances[0]!
    closeSplashWindow(win)
    closeSplashWindow(win) // already destroyed
    closeSplashWindow(null)
    closeSplashWindow(undefined)
    expect(inst.destroy).toHaveBeenCalledOnce()
  })

  it('swallows destroy() errors without leaking them', () => {
    const win = createSplashWindow()
    const inst = h.instances[0]!
    inst.destroy.mockImplementationOnce(() => { throw new Error('boom') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => closeSplashWindow(win)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
