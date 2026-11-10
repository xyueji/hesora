import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * 启动过渡页（splash）：冷启动时 main 进程要先打开 SQLite、跑迁移、加载渲染进程，
 * 期间主窗口保持 show:false，用户会以为"点了没反应"。这里在 app.whenReady() 之后
 * 立即显示一个轻量无边框窗口作为过渡，主窗口 ready-to-show 时再关闭。
 *
 * 设计约束：
 * - 只依赖 Electron + Node 内置模块；不碰数据库、不碰业务层，不阻塞主进程。
 * - splash.html 通过 extraResources 打进 resources/（见 package.json build.extraResources），
 *   不依赖 electron-vite 的多入口（renderer 目前只有 index.html 一个入口）。
 * - 本窗口不参与单实例锁、不监听 window-all-closed，也不应阻止 app.quit()：
 *   关闭逻辑只在主窗口 ready-to-show 或启动异常兜底里调用。
 */

// 与 createWindow() 主窗口保持同一套浅色配色（AGENTS.md：原创配色，不用竞品蓝）。
const SPLASH_BG = '#F5F7F3'
const SPLASH_WIDTH = 420
const SPLASH_HEIGHT = 280

/** splash.html 的稳定绝对路径：打包后位于 resources/，开发时位于项目 resources/。 */
function resolveSplashFile(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'splash.html')
    : join(app.getAppPath(), 'resources/splash.html')
}

/**
 * 创建并立即显示 splash 窗口。同步返回，不做任何 await / 异步等待，避免延迟首屏。
 * 调用方应持有返回值，在合适时机交给 closeSplashWindow()。
 */
export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    title: '禾序进销存 · 正在启动',
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    frame: false,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: SPLASH_BG,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 纯静态本地页面；加载失败也不抛未捕获异常（splash 只是过渡装饰，不能拖垮启动）。
  void splash.loadFile(resolveSplashFile()).catch((error: unknown) => {
    console.warn('[splash] load failed:', error)
  })

  return splash
}

/**
 * 幂等关闭 splash：重复调用、或窗口已被系统销毁时都安全（isDestroyed 检查）。
 * 异常路径（initialize 抛错、app 退出兜底）也应调用，避免残留窗口阻塞退出。
 *
 * 必须用 destroy() 而不是 close()：splash 设置了 closable:false（防止用户手动关掉
 * 过渡页），而 Windows/Electron 下对 closable:false 的窗口调用 close() 是 no-op，
 * 会永久残留一个 alwaysOnTop 的置顶窗（v1.4 真机 bug）。destroy() 不受 closable
 * 限制，且 splash 是纯静态过渡页、无未保存状态，可安全强制销毁。
 */
export function closeSplashWindow(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return
  try {
    win.destroy()
  } catch (error: unknown) {
    console.warn('[splash] close failed:', error)
  }
}
