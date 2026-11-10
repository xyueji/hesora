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
| B1 | 桌面快捷方式默认创建 | ✅ 通过（构建配置 + 代理 NSIS 编译验证） | `package.json` `build.nsis.createDesktopShortcut:'always'` → `-DRECREATE_DESKTOP_SHORTCUT`；`createStartMenuShortcut:true`。**诚实披露**：assisted NSIS 无内建「桌面快捷方式」可见复选框，实现为「必然创建」而非「默认勾选的复选框」（与用户「默认勾选」意图等价但形态不同） |
| B2 | 点「完成」不再卡半天 | ✅ 通过（构建配置） | `build.nsis.runAfterFinish:false` → `-DHIDE_RUN_AFTER_FINISH`，完成页不再有「运行程序」复选框，点完成安装器立即退出；根因是原先勾选「运行程序」触发 Electron 冷启动（37 个 migration + 界面加载）用户看不到反馈 |
| B3 | 启动过渡页 | ✅ 通过（自动 + 待真机冒烟复核） | `src/main/splash.ts`：`createSplashWindow()`（420×280、frame:false、sandbox、loadFile 容错）/ `closeSplashWindow()`（幂等）；`resources/splash.html` 原创浅色「正在启动…」页；`package.json` `build.extraResources` 把 splash.html 放进 `resources/`；`src/main/index.ts` 接线：`app.whenReady().then(() => { splashWindow = createSplashWindow(); initialize() })`、主窗口 `ready-to-show` 时 `closeSplashWindow(splashWindow)`，主窗口保持 `show:false`；catch 分支先关过渡页再报错退出。不参与单实例锁 / `window-all-closed` / 不阻止 `app.quit` |
| B4 | NSIS 自定义脚本可编译（含卸载器） | ✅ 通过（代理编译验证） | `installer.nsh`：`!ifndef BUILD_UNINSTALLER` + `!ifndef MUI_FINISHPAGE_TEXT` 守卫定义中文完成页说明，不重复定义 `MUI_PAGE_CUSTOMFUNCTION_PRE`（assistedInstaller.nsh:30 无条件定义，避 `-WX` 重复 define 失败）；代理用 electron-builder 缓存 makensis.exe 3.0.4.1 复刻 SHARED HEADER 顺序，`-WX -INPUTCHARSET UTF8`：安装器 INSTALL_EXIT=0、卸载器(BUILD_UNINSTALLER) UNINSTALL2_EXIT=0。UTF-8 无 BOM |

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
| D2 | 客户端状态机（6 态）+ 凭据持久化 + 自动重连 | ✅ 通过（自动） | `src/main/host/client-connection.ts`（715 行，`HOST_DEFAULT_PORT=18650`，idle/pairing/connecting/connected/revoked/error，pairStart → /pair/start → 轮询 /pair/result → /auth/session → WS 事件）；`src/main/host/host-events-client.ts`；`src/main/index.ts` 接线（`lan:invoke`、`lan:clientStatusSync`、双 flushPending） |
| D3 | 渲染层连接 UI + 断线禁写 | ✅ 通过（自动 + 人工核对） | `src/renderer/src/views/system/ClientConnectView.vue`（252 行：表单/配对码倒计时/五态 UI）、`src/renderer/src/lib/client-state.ts`（`clientWriteBlocked` computed）、`src/renderer/src/layouts/MainLayout.vue` 连接状态条、`src/renderer/src/views/retail/RetailView.vue`（收款按钮 `:disabled`）、`src/renderer/src/views/sale/SaleEditView.vue`（`canSave` 含 `!clientWriteBlocked.value` + el-alert）。单机模式不受影响 |
| D4 | 端到端集成测试（配对→会话→调用→吊销→幂等重发） | ✅ 通过（自动） | `tests/unit/client-connection.test.ts`（2 用例：full flow + disconnect/pending 幂等重发，2/2 绿）。**修复记录**：第 2 用例 server2 曾传空 `handlers` 表 → /rpc 回 NOT_FOUND → pending 被判确定性失败删除 → 超时；改为 `handlers2` 同时传给 `createHostServer` 与 `createGateway` 后通过 |
| D5 | 手册与验收文档 | ✅ 通过（人工核对） | `docs/user-manual-v1.3-lan.md` §2 整节重写为已实现版（入口、配对流程、断线禁写、DPAPI 重连、吊销、五态表）；`docs/errata-note.md` 两错误码并入 §3.2；本文件 |

## 测试与构建快照

- 全量 `npx vitest run`：**102 测试文件 / 817 用例全绿**（含新增 45 例 `update.service.test.ts`、
  271 行 `client-connection.test.ts` 2 例、`trial-payload.test.ts` 5 例、`trial-state.test.ts` 12 例）。
- `npm run typecheck:node` / `npm run typecheck:web`：双绿（均带 `--composite false`）。
- 打包冒烟（`pnpm dist`）：待执行，重点验证 splash.html 进 `resources/`、NSIS 完成页中文且点完成立即退出、桌面/开始菜单快捷方式、首启过渡页正常关闭。
- 包产物：`dist/禾序进销存-1.4.0-setup.exe`（SHA256 待打包后填）。

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

## 已知限制 / 待真机验收

- 跨物理机（非 127.0.0.1）配对、真实路由器/防火墙、多客户端并发：**待真机验收**（集成测试为进程内双实例）。
- 可见「桌面快捷方式」复选框未落地（assisted NSIS 无内建），以必然创建替代；如需复选框需完全自定义 MUI 完成页（二期）。
- 提示式更新非自动下载安装；真一键需 electron-updater + 代码签名（二期）。
- 安装包未签名，Windows SmartScreen 可能拦截（README 已给 4 步放行说明）。
- 时间同步依赖（x-ts ±120s）；mDNS 主机自动发现未实现。
- 客户端授权口径：当前按机授权（每台客户端需各自的专业版/试用许可），「主机授权覆盖多机」为待用户裁决项。
- 用户待办：自行保管 Gitee 私人令牌 + GitHub PAT、建 tag=latest release 上传固定包名附件、两仓库 main 分支 latest.json 同步（version 递增、sha256 必填、url 可省略）；**严禁把源码推上去**。
