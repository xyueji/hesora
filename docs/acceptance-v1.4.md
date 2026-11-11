# v1.4.0 验收记录（试用全功能 / 安装器体验 / 双渠道更新 / 客户端接线）

对照本轮四项需求（用户 m04659、m04754、m04829、m04912）与 v1.4 收尾清单。
测试基线见文末「测试与构建快照」。

## A. 7 天全功能试用（去延期）

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| A1 | 试用口径改为 7 天、删除一切延期机制 | ✅ 通过（自动） | `src/shared/license.ts`：`TRIAL_DAYS=7`、删除 `TRIAL_TOTAL_DAYS`、`TrialPhase='trial'\|'expired'\|'activated'`、`isTrialExpiredWrite` 删 `extended` 分支；`src/main/services/license/license.service.ts` `getStatus()`：`daysLeft=max(0,TRIAL_DAYS-elapsed)`、删 `extendTrial()`/`trial_extended` 字段、已激活早返回；`src/main/ipc/handlers.ts` 删 `trial:extend`；`tests/unit/ipc-handlers-parity.test.ts` 期望清单无 extend。全库 grep 无「15 天」/extendTrial/trial:extend/trial_extended 残留 |
| A2 | 试用期内解锁专业版全部功能 | ✅ 通过（自动） | `src/main/services/license/trial-payload.ts`：`TRIAL_FULL_PAYLOAD`（professional + 6 特征位 + `maxDevices:Number.MAX_SAFE_INTEGER`）、`effectiveLicensePayload(real,fullAccess)` = `fullAccess ? (real ?? TRIAL_FULL_PAYLOAD) : null`；`tests/unit/trial-payload.test.ts`（5 用例，含 `effectiveLicensePayload(null,false)===null` 安全边界） |
| A3 | 主进程所有门控点统一注入试用载荷 | ✅ 通过（自动） | `src/main/index.ts` 的 `currentLicensePayload()` helper（`fullAccess = phase==='trial' \|\| phase==='activated'`）统一供 5 个生产点：`HandlerDeps.licensePayload`、模块级 `licensePayload`、`assertDeviceLimit`、`lanAllowed` 两处 `hasFeature`、`assertClientLicensed`；`src/main/ipc/handlers.ts` 14 处 `assertFeature/assertProEdition/assertMaxDevices` 全经 `deps.licensePayload()` 单一注入点 |
| A4 | 试用到期（expired）不得越权使用专业版 | ✅ 通过（自动） | `expired` → `fullAccess=false` → `effectiveLicensePayload` 返回 null → 所有门控拒绝；`tests/unit/trial-state.test.ts`（12 用例）覆盖 trial/expired/licensed 三态 |
| A5 | UI 与文档口径一致（无「延长 7 天」按钮/文案） | ✅ 通过（人工核对） | `AboutView`/`DashboardView` 删延期按钮、`ActivateView` 改 7 天；`docs/acceptance-v1.1.md:37`、`docs/errata-note.md:9`、`docs/superpowers/specs/2026-11-09-v1.3-pro-lan-spec.md:653`、`docs/superpowers/plans/2026-11-09-v1.3-pro-lan.md:664`、`docs/audit-master.md:70`、`docs/audit-p4.md:14`、`docs/user-manual-v1.1.md:685` 全部按 v1.4 口径更新；旧命名残留（seed.ts 注释、router.ts 注释、`DashboardView` 局部常量）已清理 |

## B. 安装器体验（桌面快捷方式 / 完成页 / 启动过渡页）

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| B1 | 完成页两复选框（v1.4.0 追加需求，用户 m06629）| ✅ 通过（重打包 BUILD_EXIT=0）| `installer.nsh` 借用 MUI2 内建 `MUI_FINISHPAGE_RUN`（文本改「运行 ${PRODUCT_NAME}」）与 `MUI_FINISHPAGE_SHOWREADME`（文本改「创建桌面快捷方式」）两个复选框槽位，均不定义 `*_NOTCHECKED` → **默认勾选、可取消**；SHOWREADME 的 LEAVE 回调 `HesoraCreateDesktopShortcut` 用 `CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk"`（-D define 现场拼路径，因 SHARED HEADER 先于 Var 声明编译，warning 6000 → -WX 失败的教训已注释）；`build.nsis.createDesktopShortcut:false` → 安装段不自动建桌面快捷方式、`customUnInstall` 钩子补删卸载清理；`runAfterFinish:false` 已删除 → assistedInstaller 恢复内建「运行程序」复选框 + `StartApp`（ExecShellAsUser） |
| B2 | 点「完成」不再卡半天 | ✅ 通过（配置 + 设计） | 「运行程序」复选框现由内建 `MUI_FINISHPAGE_RUN` + `StartApp`（`StdUtils.ExecShellAsUser` 异步启动，不阻塞安装器进程）承载；且首启动有 splash 过渡页兜底冷启动观感 |
| B3 | 启动过渡页 | ✅ 通过（自动 + 真机冒烟复核） | `src/main/splash.ts`：`createSplashWindow()`（420×280、frame:false、`closable:false`、`alwaysOnTop:true`、sandbox、loadFile 容错）/ `closeSplashWindow()`（幂等，**必须用 `destroy()` 而非 `close()`**）；`resources/splash.html` 原创浅色「正在启动…」页；`package.json` `build.extraResources` 把 splash.html 放进 `resources/`；`src/main/index.ts` 接线：`app.whenReady().then(() => { splashWindow = createSplashWindow(); initialize() })`、主窗口 `ready-to-show` 时 `closeSplashSafely()`，主窗口保持 `show:false`；catch 分支先关过渡页再报错退出；20s 安全网 `closeSplashSafely()`。不参与单实例锁 / `window-all-closed` / 不阻止 `app.quit`。**真机 bug 修复（用户 m05812「启动中窗口在程序打开后没消失啊」）**：原 `closeSplashWindow()` 用 `win.close()`，但 Windows/Electron 对 `closable:false` 的窗口调 `close()` 是 no-op（最小探针 `electron.exe tools/tmp-probe-closable.cjs` 实证 `isDestroyed()` 始终 false），导致 `alwaysOnTop` 置顶过渡页永久残留；改为 `win.destroy()`（不受 closable 限制，splash 无未保存状态可安全强制销毁），并新增 `tests/unit/splash.test.ts`（4 用例：非 closable 配置、断言用 destroy 不用 close、幂等/null 安全、destroy 抛错被吞）锁住回归 |
| B4 | NSIS 自定义脚本可编译（含卸载器） | ✅ 通过（完整 pnpm dist 权威验证） | `installer.nsh` 编译约束（实测）：SHARED HEADER 先于 `LogicLib.nsh`（MUI2 引入）与 WinShell 插件注入、先于 `installer.nsi` 的 Var 声明 → 函数体禁 `${If}`/`WinShell::`/Var 引用；卸载器清理走 `customUnInstall` 宏（插入点编译，插件可用）。首跑复刻管道报 `Bad text encoding`（!include 不走 -INPUTCHARSET，按 ANSI 读）与 warning 6000 → 均以完整 pnpm dist 作权威验证 |

## C. 双渠道更新（Gitee 优先 / GitHub 回退）

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| C1 | 默认双渠道、Gitee 在前 | ✅ 通过（自动） | `src/main/update.ts`：`DEFAULT_GITEE_URL='https://gitee.com/xyueji/hesora/raw/main/latest.json'`、`DEFAULT_GITHUB_URL='https://raw.githubusercontent.com/xyueji/hesora/main/latest.json'`；env `HESORA_UPDATE_GITEE_URL`/`HESORA_UPDATE_GITHUB_URL` 覆盖，旧 `HESORA_UPDATE_URL` 作唯一渠道兼容 |
| C2 | 渠道失败才回退；有效但无更新立即返回（防陈旧遮蔽） | ✅ 通过（自动） | `src/main/services/update/update.service.ts` `checkChannel()`：非法 URL / fetch 抛错 / 非 2xx / JSON 非法 / 版本非法 / url 非法 → failed 才回退；有效但版本不新 → `return { hasUpdate:false }` 不回退；全失败静默；`tests/unit/update.service.test.ts`（45 用例） |
| C3 | Gitee raw 302 → CDN 跟随（P0 实测修复） | ✅ 通过（自动） | `defaultFetch()` 每次请求新建 `AbortSignal.timeout(10000)` 且 `redirect:'follow'`（`DEFAULT_REDIRECT` 常量，原 `'error'` 会让 Gitee 每次判 failed 而回退 GitHub，令「Gitee 优先」失效）；`DEFAULT_ALLOW_HOSTS` 补 `raw.giteeusercontent.com` / `*.giteeusercontent.com`；单测断言 `redirect==='follow'` 且 signal per-request 防回归；`docs/update-channels.md:163-167` 附 302 实测证据 |
| C4 | 固定 tag / 固定包名 / 默认下载地址 | ✅ 通过（自动） | `UPDATE_RELEASE_TAG='latest'`、`UPDATE_PACKAGE_NAME='hesora-inventory-setup.exe'`、`resolveDownloadUrl()` 在 manifest.url 省略时拼 `https://gitee.com/xyueji/hesora/releases/download/latest/hesora-inventory-setup.exe` |
| C5 | 下载 URL 白名单与 openUrl 校验 | ✅ 通过（自动） | `DEFAULT_ALLOW_HOSTS`（github.com / *.githubusercontent.com / github.io / *.github.io / gitee.com / *.gitee.com / gitee.io / *.gitee.io / raw.giteeusercontent.com / *.giteeusercontent.com）；`isValidUrl` 要求 https 且无 username/password；`src/main/update.ts` `'update:openUrl'` 用 `allowedUrl`（check 时赋值）精确匹配后 `shell.openExternal` |
| C6 | 通知展示 sha256 + 复制（渲染层防御） | ✅ 通过（自动 + typecheck） | `src/renderer/src/layouts/MainLayout.vue` `notifyUpdate()`：`h('div',...)` 展示 `SHA-256: 前 8 位…` 与「复制全文」；修正两处缺陷：`navigator.clipboard` 不存在时先 `ElMessage.warning` 返回再 `.writeText().then().catch()`，复制链接 `e.stopPropagation()` 防触发通知整体 onClick 打开下载；`npm run typecheck:web` 绿 |
| C7 | 用户红线（不推源码 / 发布凭证说明） | ✅ 通过（人工核对） | `docs/update-channels.md` 与 README 更新章节：发布仓库仅分发 `latest.json` + tag=latest 附件、**严禁 git push 源码**、本地仓库无 remote、SSH 公钥 ≠ 发布凭证（发布用 Gitee 私人令牌 + GitHub PAT(repo)，token 仅本地保管绝不入包）、客户端匿名 HTTPS 无凭据；含「发版必读：安装包重命名与双仓库附件」 |

> **现实边界（诚实披露）**：当前仍是**提示式更新**（检查 → 提示 → 浏览器打开下载页 → 用户手动下载覆盖安装），
> 并非「点更新就自动下载并安装」。真·一键自动更新需二期引入 electron-updater + 代码签名（当前安装包未签名）。

## D. 客户端接线（T9-Client，LAN 协作闭环）

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| D1 | 主机下发证书指纹 /pair/start + /pair/result | ✅ 通过（自动） | `src/main/host/server.ts` granted 结果含 `fingerprintHex`；`src/main/host/client-credentials.ts`（DPAPI 按 host 存取，不明文落盘） |
| D2 | 客户端状态机（6 态）+ 凭据持久化 + 自动重连 | ✅ 通过（自动 + 终审修复） | `src/main/host/client-connection.ts`（`HOST_DEFAULT_PORT=18650`，idle/pairing/connecting/connected/revoked/error，pairStart → /pair/start → 轮询 /pair/result → /auth/session → WS 事件）；`src/main/host/host-events-client.ts`；`src/main/index.ts` 接线（`lan:invoke`、`lan:clientStatusSync`、**三处** `flushPending()`：Tray 退出 / `window-all-closed` / `before-quit`）。终审修复见文末「v1.4 终审修复」 |
| D3 | 渲染层连接 UI + 断线禁写 | ✅ 通过（自动 + 人工核对） | `src/renderer/src/views/system/ClientConnectView.vue`（252 行：表单/配对码倒计时/五态 UI）、`src/renderer/src/lib/client-state.ts`（`clientWriteBlocked` computed）、`src/renderer/src/layouts/MainLayout.vue` 连接状态条、`src/renderer/src/views/retail/RetailView.vue`（收款按钮 `:disabled`）、`src/renderer/src/views/sale/SaleEditView.vue`（`canSave` 含 `!clientWriteBlocked.value` + el-alert）。单机模式不受影响 |
| D4 | 端到端集成测试（配对→会话→调用→吊销→幂等重发） | ✅ 通过（自动） | `tests/unit/client-connection.test.ts`（2 用例：full flow + disconnect/pending 幂等重发，2/2 绿）。**修复记录**：第 2 用例 server2 曾传空 `handlers` 表 → /rpc 回 NOT_FOUND → pending 被判确定性失败删除 → 超时；改为 `handlers2` 同时传给 `createHostServer` 与 `createGateway` 后通过 |
| D5 | 手册与验收文档 | ✅ 通过（人工核对） | `docs/user-manual-v1.3-lan.md` §2 整节重写为已实现版（入口、配对流程、断线禁写、DPAPI 重连、吊销、五态表）；`docs/errata-note.md` 两错误码并入 §3.2；本文件 |



## 追加：安装完成页两复选框（用户 m06629，2026-11-11）

用户要求完成页显示「创建桌面快捷方式」「运行程序」两个可选复选框且**默认勾选**。实现：`build.nsis.createDesktopShortcut:false`（关掉安装段自动创建与模板卸载清理）、删除 `runAfterFinish:false`（恢复内建运行框）；`installer.nsh` 重写——`MUI_FINISHPAGE_RUN_TEXT`/`MUI_FINISHPAGE_SHOWREADME`+TEXT/FUNCTION 借 MUI2 两槽位，`HesoraCreateDesktopShortcut` 函数体只用核心指令+内置 System 插件（SHARED HEADER 编译顺序约束：早于 LogicLib/WinShell 插件/Var 声明）；卸载清理走 `customUnInstall` 宏。重打包 BUILD_EXIT=0，最终包 86,596,016 B、SHA256 403e021e…75c8e85。真机验证待用户安装时确认。
## 测试与构建快照

- 全量 `npx vitest run --reporter=dot`（v1.4 终审修复 + 单测补齐后最终复跑）：
  **105 测试文件 / 831 用例全绿**（Duration 160.15s，VITEST_EXIT=0）。演进：
  817 → 821（真机 splash bug 修复，新增 `tests/unit/splash.test.ts` 4 例）→ 831
  （新增 `tests/unit/client-credentials.test.ts` 4 例、`tests/unit/host-events-client.test.ts` 3 例，
  `host-server.test.ts` +2 例配对限流回归、`t8-modules.test.ts` +1 例 reconnect 复位）。
- `npm run typecheck:node` / `npm run typecheck:web`：双绿（均带 `--composite false`，NODE_EXIT=0 / WEB_EXIT=0）。
- 打包冒烟（`pnpm dist`，终审修复后**第二次重打包** BUILD_EXIT=0）：`hesora-smoke-140.js`
  重跑 **PASS**（SMOKE_EXIT=0）——捕获到 splash.html 与主窗口 index.html 两个页面、
  主窗口存活 6s 无崩溃、启动过渡页 `isClosed()===true`（`destroy()` 生效）。
  冒烟脚本主动轮询 `app.context().pages()` + 全步骤超时，避免 `app.on('window')` 订阅竞态与挂起。
- 包产物：`dist/禾序进销存-1.4.0-setup.exe`（**最终包 86,596,016 B，SHA256
  `403e021e196d8efffecacbf18802c34b3c30f93eb7bf7a3250055e5ef75c8e85`**）；
  `dist/win-unpacked/resources/splash.html` 2379 B 已进 `resources/`；`app.asar` 内 `out/main/index.js`
  已核实含 `win.destroy()`、`defaultFetch`、`probeRateBuckets`、`markSessionExpired`、
  `clearPendingCredentials`（`grep -ao` 实证），确认终审修复确实打进包。
- 未签名（`no signing info identified`），符合当前预期；SmartScreen 放行见 README。

## 本轮审查与修复记录

- spec 合规预审（c8147dac）：REQUEST CHANGES，Blocking 代码缺陷=0，仅 3 条文档口径缺陷
  （B1 acceptance-v1.1 延期、B2 errata E_FEATURE_PRO、B3 spec/plan trial/extended）+ 5 条 Should-fix，全部修复。
- 质量预审（217b2223）：REQUEST CHANGES，1 个 **Blocking P0**：
  - **B-1** `DEFAULT_FETCH_INIT` 把 `AbortSignal.timeout(10000)` 提到模块级常量，进程 >10s 后所有真实
    更新检查静默失败（双渠道 production 全废）。修法：改 `DEFAULT_REDIRECT` 常量 +
    `defaultFetch()` 每次新建 signal；补 2 个走真实 `globalThis.fetch` 的回归用例（连续 2 次
    check 断言 signal 不同且未 aborted）；42 个全注入 `fetchImpl` 的旧用例抓不到，故新增真实路径覆盖。
  - S-1 `update:openUrl` rejection 穿透成渲染层未处理 Promise rejection → 主进程 try/catch 返回 false +
    MainLayout `.then/.catch` 给 ElMessage 反馈；另把 `checkDaily()` 的 `lastCheckAt` 改为**成功后**才写
    （IPC 抛错不再白占 24h 窗口）。
  - S-2 三条 `updateUrl:'u'` 空壳单测改合法 GITEE_URL 并断言 fetchImpl 真被调用；S-3 302 用例补
    真实 `globalThis.fetch` 链路断言；N-1 `sourceFromUrl` 补 `*.giteeusercontent.com` 归类；
    N-4 过时注释清理；N-5 splash 加 20s 安全网 `closeSplashSafely()`（防 alwaysOnTop 置顶窗残留）。
- 真机冒烟发现（用户 m05812「启动中窗口在程序打开后没消失啊」）：**启动过渡页不消失**。
  根因不是 20s 安全网缺失，而是 `splash.ts` 的 `closable:false` 与 `closeSplashWindow()` 用
  `win.close()` 冲突——Windows/Electron 下 `close()` 对 `closable:false` 窗口是 no-op，
  安全网调同一个 `closeSplashWindow()` 同样无效。最小探针实证后把 `closeSplashWindow()`
  改为 `win.destroy()`（不受 closable 限制、splash 无未保存状态可安全强制销毁），
  补 `tests/unit/splash.test.ts`（4 用例）回归锁，并重写 `hesora-smoke-140.js`
  （主动轮询 `app.context().pages()`、全步骤超时、断言 splash `isClosed()`）。
  修复后**重新打包**（main 源码改动需重建 asar）并重跑冒烟。

## 已知限制 / 待真机验收

- 跨物理机（非 127.0.0.1）配对、真实路由器/防火墙、多客户端并发：**待真机验收**（集成测试为进程内双实例）。
- ~~可见「桌面快捷方式」复选框未落地~~（v1.4.0 追加需求已落地：借用 MUI_FINISHPAGE_SHOWREADME 槽位实现「创建桌面快捷方式」复选框，默认勾选可取消；运行复选框由内建 MUI_FINISHPAGE_RUN 承载，同样默认勾选可取消）。
- 提示式更新非自动下载安装；真一键需 electron-updater + 代码签名（二期）。
- 安装包未签名，Windows SmartScreen 可能拦截（README 已给 4 步放行说明）。
- 时间同步依赖（x-ts ±120s）；mDNS 主机自动发现未实现。
- 客户端授权口径（用户已裁决）：**按机授权**——每台客户端各自需专业版授权或处于 7 天试用期内；不采用「主机授权覆盖多机」。
- **LAN 主动中间人（MITM）**：本版适用于可信小局域网（3 台以内设备）。配对阶段（`/pair/start`、`/pair/result`）与登录（`/auth/session`）采用 TOFU，无证书鉴证；配对完成后的 `/rpc`、`/events` 虽核对 `sha256(peerCert.raw)`，但比对发生在 HTTP 响应回调 / WS `open` 回调，**请求体（含登录口令、会话 token、HMAC 签名业务报文）已经发出**。能主动实施 ARP 欺骗或架设恶意热点者可在配对窗口冒充主机并窃取口令与设备密钥。普通被动嗅探/改 UI 无法绕过（Ed25519 授权、HMAC × 时间戳 × nonce、DPAPI）。彻底加固（自定义 `https.Agent`/`tls.connect` 在写 body 前先验指纹、WSS upgrade 前校验、`/auth/session` 走 pinning 通道、向导显示主机指纹供人工核对）列入 **v1.4.1 专项**，本期按用户裁决「如实披露后发 v1.4」。
- **发版阻塞项（必须处理）**：`resources/license-public-key.txt` 目前只是占位注释（无真实 Ed25519 公钥），`loadInjectedPublicKey()` 返回 undefined → `parseCode()` 恒 null → 激活码永远校验失败，7 天后用户无法解锁。发行前须用 `tools/activation-server/gen.js` 生成密钥对，把**公钥**注入 `HESORA_LICENSE_PUBLIC_KEY` 环境变量或替换占位文件后重新构建，**私钥仅存发行端、绝不入包**，并真机验证「到期 → 输码 → 解锁」。
- **防逆向边界**：Ed25519 非对称验签 + 单调时钟能防普通用户改 UI/删库重置试用；但客户端是 Electron + 明文 JS 打进 `app.asar`（`build` 仅 `{asar:true, files:['out/**/*']}`，未启用 fuses / `EnableEmbeddedAsarIntegrityValidation` / `onlyLoadAppFromAsar` / 字节码 / 混淆 / 代码签名），会改 asar 的逆向者可 patch `isTrialExpiredWrite` / `currentLicensePayload`、替换公钥自签自发码。彻底防需代码签名 + Electron fuses + 授权判定下沉原生 `.node` + 在线心跳（后两项与「完全离线」冲突）。本期未纳入，按用户裁决留待后续版本。
- 用户待办：自行保管 Gitee 私人令牌 + GitHub PAT、建 tag=latest release 上传固定包名附件、两仓库 main 分支 latest.json 同步（version 递增、sha256 必填、url 可省略）；**严禁把源码推上去**。

## v1.4 终审修复（用户拍板：修必需项 + 廉价加固 + MITM 限制披露后发版）

两路只读终审（1303b755 功能合规 / ee60c8f2 质量安全）发现必修缺陷，按用户裁决范围修复：

| 项 | 修复 | 证据 |
|---|---|---|
| 配对轮询撞限流（2s × 5min TTL 第 11 次 429 → 轮询终止） | `server.ts` 拆出 `probeRateBuckets`：`/pair/result` 命中已知码不计费，仅未知码走独立限流；客户端对 `RATE_LIMIT` 退避续轮询 | `host-server.test.ts` 新增 2 用例（15 次已知码轮询全 200 / 11 次未知码 429），22/22 绿 |
| `reconnect.stop()` 不可逆（断开/吊销后自动重连永久死亡） | `markConnected()` 复位 `stopped=false` | `t8-modules.test.ts` 新增回归用例，11/11 绿 |
| 8h 会话过期误判为「设备吊销」 | 新增 `markSessionExpired()`（error + `E_SESSION_EXPIRED` → UI 显示「重连主机」），`E_AUTH_FAILED` 不再一律 `markRevoked`；真吊销仍走 WS 4003 / `E_NOT_PAIRED` | `client-connection.ts`；`user-manual-v1.3-lan.md` §3.2 |
| 吊销与在途 401 竞态（`error` 覆盖 `revoked`） | `markSessionExpired()` 在 `status==='revoked'` 时早返回 | 批量复跑 55/55 绿（含 full flow 吊销用例） |
| 首次配对成功建立 2 条 WSS / 吊销后 WS 无限重连 | `host-events-client.connect()` 加 `socket` 幂等守卫（含 `import('ws')` 异步二次检查）；`markRevoked`/`markSessionExpired`/`disconnect`/`forget` 均关 WS 并置空 | `host-events-client.ts`、`client-connection.ts` |
| 试用门控只覆盖 `pairStart` | `reconnect` / `restore` / `invoke` 各加 `assertLicensed` 守卫；`index.ts` 的 `lan:invoke` 也调 `assertClientLicensed()`；`restore` 失败时清内存 `configured` 防 `clientModeActive` 误挡本地业务 | `client-connection.ts`、`src/main/index.ts` |
| 主机/客户端角色无互斥（双库分叉） | 主机启动条件加 `!clientConfiguredRow`；网关 handlers 每通道包 `E_CLIENT_MODE` 包装 | `src/main/index.ts` |
| `lan:invoke` 无通道白名单 + 8h token 回传渲染层 | 加 `LOCAL_CHANNEL_PREFIXES`/`HOST_ONLY_PREFIXES` 白名单拒绝；`completeSession()` 改 `ok(null)` 不回传 token | `src/main/index.ts`、`client-connection.ts` |
| 配对指纹可被空值静默放行 / 双重 `as` 断言 | `PairingStart` 接口显式声明 `fingerprintHex`；granted 要求 start 与 granted 指纹**都非空且相等**，否则 `E_FINGERPRINT_MISMATCH` | `client-connection.ts` |
| 明文口令常驻内存 / DPAPI 不可用时 forget 删不掉凭据 | 新增 `clearPendingCredentials()`（登录成功/断开/忘记/吊销/过期均清）；`client-credentials.remove()` 去掉 `!available()` 早返回；tmp 文件名加 pid+随机后缀 | `client-connection.ts`、`client-credentials.ts` |
| `client-pending.json` 畸形条目灌入 pending | `pendingPersist.load()` 逐项校验 requestId/channel/payload | `src/main/index.ts` |
| 死代码 / 空壳断言 | 删除 `pendingGrant` 死变量；更新通知 UI 与更新服务单测补真实路径覆盖（见质量预审记录） | 全库 grep 无 `pendingGrant` |
