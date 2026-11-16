# 启动过渡页（splash）接线补丁

> 适用对象：合并 `src/main/index.ts` 的一方（本任务**未改动** `index.ts`，因该文件由其他代理并行改动）。
> T9-Client 提交后 `index.ts` 的行号会整体漂移，所以下面给出**可直接粘贴的代码片段**（按「定位文本」而非行号），请按顺序套用。
> 配套文件：`src/main/splash.ts`（导出 `createSplashWindow()` / `closeSplashWindow(win)`）、`resources/splash.html`（经 `build.extraResources` 打到 `resources/splash.html`）。

## 行为约定（务必保持）

- `createSplashWindow()` **同步**创建并立即显示，不做任何 `await`，不碰数据库/业务层，**不阻塞主进程**。
- `closeSplashWindow(win)` **幂等**：内部先判 `if (!win || win.isDestroyed()) return`，重复调用/窗口已销毁都安全；`try/catch` 包住 `win.close()`。
- **splash 窗口不参与单实例锁、不监听 `window-all-closed`，也不阻止 `app.quit()`**：
  - 单实例锁与 `second-instance` 处理保持原样，不要把 splash 加进去；
  - 正常路径靠主窗口 `ready-to-show` 关闭；启动异常路径靠 `app.whenReady().then(...).catch(...)` 里显式关闭；`app.quit()` 会强制关掉包括 splash 在内的所有窗口。
- 主窗口保持现有 `show: false` + `ready-to-show` 语义，不要改成直接 show。
- `initialize()` 内部（尤其 lanAllowed / assertDeviceLimit / licensePayload / clientConnection 段落）**一行都不要动**。

## 片段 1 — import（放在 `index.ts` 顶部 import 区任意位置）

```ts
import { createSplashWindow, closeSplashWindow } from './splash'
```

## 片段 2 — 模块级变量（放在其它模块级 `let ...` 附近，如 `hostServerRef` / `clientConnectionRef` 旁）

```ts
// 启动过渡页：app.whenReady() 后立即显示，主窗口 ready-to-show 或启动异常时关闭。
// 不参与单实例锁、不监听 window-all-closed，也不阻止 app.quit()。
let splashWindow: ReturnType<typeof createSplashWindow> | null = null
```

## 片段 3 — `app.whenReady()` 区块（**整段替换**现有的 `.then(initialize)` 链）

把原来的：

```ts
  void app.whenReady().then(initialize).catch((error: unknown) => {
    dialog.showErrorBox('禾序进销存无法启动', error instanceof Error ? error.message : String(error))
    app.quit()
  })
```

替换为：

```ts
  void app.whenReady().then(() => {
    // 过渡页在任何 SQLite 打开 / migration / renderer 加载之前立即显示。
    splashWindow = createSplashWindow()
    initialize()
  }).catch((error: unknown) => {
    // 异常兜底：先关过渡页，避免残留窗口阻塞退出；随后 app.quit() 强制收尾。
    closeSplashWindow(splashWindow)
    splashWindow = null
    dialog.showErrorBox('禾序进销存无法启动', error instanceof Error ? error.message : String(error))
    app.quit()
  })
```

> 注意：`initialize()` 仍是原来的同步函数，这里只是把它包进 `.then(() => { ... })`，不改其签名、不改成 async。

## 片段 4 — `createWindow()` 里的 `ready-to-show`（**整段替换**现有 handler）

把原来的：

```ts
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
```

替换为：

```ts
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // 主窗口已绘制：幂等关闭过渡页（重复触发 / 已销毁都安全）。
    closeSplashWindow(splashWindow)
    splashWindow = null
  })
```

> `createWindow()` 在 `initialize()` 末尾及若干分支里都会被调用（如 `createWindow()` / `activate` 里的 `createWindow()`），
> 但 `ready-to-show` handler 只在 `createWindow()` 内部定义一次，所以改这一处即可覆盖所有创建路径，无需逐处加关闭逻辑。

## （可选加固）渲染进程加载失败时的兜底

`ready-to-show` 依赖 renderer 正常绘制。若担心页面加载异常导致过渡页滞留，可在片段 3 的 `.then` 内追加一个一次性超时兜底（不影响正常路径，只是防止极端情况）：

```ts
    splashWindow = createSplashWindow()
    // 20s 安全网：若主窗口因异常始终未 ready-to-show，也别让过渡页常驻。
    const safety = setTimeout(() => {
      closeSplashWindow(splashWindow)
      splashWindow = null
    }, 20_000)
    // 片段 4 的 ready-to-show / 异常 catch 里可 clearTimeout(safety)（可选）。
    void safety
    initialize()
```

默认实现（片段 3+4）已覆盖：启动抛错（catch 关闭）、正常启动（ready-to-show 关闭）、`app.quit()`（强制关所有窗口）三类路径；这段仅为更保守的可选项。

## 自检清单

- [ ] `createSplashWindow()` 在 `app.whenReady()` 之后、`initialize()` 之前调用；
- [ ] 主窗口仍是 `show: false`，仅 `ready-to-show` 时 show；
- [ ] `ready-to-show` 与 `.catch` 都调用了 `closeSplashWindow(splashWindow)` 并置空；
- [ ] `initialize()` 函数体没有任何改动；
- [ ] 单实例锁 / `window-all-closed` / `before-quit` 段落没有引用 splash；
- [ ] `resources/splash.html` 已由 `build.extraResources` 映射为 `splash.html`（打包后位于 `process.resourcesPath`，开发时位于 `app.getAppPath()/resources/`）。
