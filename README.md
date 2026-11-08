# 禾序进销存 · HESORA Inventory

**货有数，账有序。** 禾序是一款面向商户与中小企业的 Windows 本地进销存软件，让进货、销售、库存和往来账目清楚有序。日常业务在本机运行，经营数据默认存放于本机，可按需备份、恢复与导出。

[品牌说明与视觉规范](../docs/brand/品牌说明.md)

## 功能清单

- **商品**：商品档案（分类/规格/条码/进价/售价）、启用停用、CSV 批量导入、价格等级（多级价）、保质期与批次效期管理
- **库存**：多仓库、库存汇总/明细/流水、成本变动明细、库存预警（单个+按条件批量）、序列号台账与流水、组装拆卸、调拨、盘点、调整售价（批量改价并记录调价日志）
- **单据**：进货/进货退货、销售/销售退货、采购退货、快速零售（POS、挂单/取单）、收款/付款单、报价→订单→销售 转单审核流、单据复制（再来一单）、单据查询与明细
- **报表**：首页经营概览、近 7 日趋势、应收应付汇总、经营报表（销售/采购/毛利/资金/热销）
- **打印**：小票打印（可选打印机）、A4 出货单导出 PDF
- **同步/备份**：手动备份/恢复、自动备份，WebDAV 或本地目录云盘同步（上传/下载/从云端恢复）
- **权限**：RBAC 角色权限——内置管理员/收银员 + 自定义角色（47 个权限点按 8 组可视化勾选），菜单与操作级权限控制，多用户管理
- **界面**：多标签页工作台（每页面一个 TAB，支持批量关闭/keep-alive 缓存）
- **试用**：首次运行即 15 天全功能试用，激活后永久使用

## 安装

1. 双击 `禾序进销存-1.1.0-setup.exe`，按向导选择安装目录即可。
2. 升级前先备份并退出旧版程序。禾序首次打开时会把旧数据目录 `%APPDATA%\zhjs-erp` 整体迁移为 `%APPDATA%\hesora-inventory`（账套、备份与设置原样保留），账套文件同时改名为 `hesora-inventory.db`。
3. 首次启动时设置本地管理员与密码。旧版若仍在使用初始管理员密码，会提示设置新密码。

正式账套首次打开为空。用 `禾序进销存.exe --demo` 可打开独立演示账套，包含模拟商户资料和贯穿采购、销售、库存及资金的业务单据。演示账套在窗口内标记为「模拟数据」，账套目录为 `%APPDATA%\hesora-inventory-demo`。

## 试用与激活

- 未激活状态下首次运行开始 **15 天全功能试用**；到期后仅登录/激活可用。
- 激活：在软件激活页粘贴商家签发的激活码，由客户端离线验签：
  - 服务端工具位于 `tools/activation-server/`（Node + SQLite，部署到 VPS 或本机运行，详见该目录 README）。
  - 流程：商家使用签发工具生成激活码 → 客户粘贴到软件激活页。
  - **`private.pem` 仅保存在服务端，绝不打入客户端安装包**（见下方发布清单）。

## 云盘同步

进入「同步备份」页面配置：

- **WebDAV**：填写地址、账号、密码（坚果云等支持 WebDAV 的网盘均可）。
- **本地目录**：选择一个目录（如 OneDrive/百度网盘同步目录）作为同步目标。
- 支持「立即上传」「下载到本地」「从云端恢复」；自动备份默认开启。
- 可逐个检查同步目标，并预览选定副本。恢复会校验版本与内容，保留当前账套副本后再重启。已有快照的 WebDAV 目标需支持强 `ETag` 和条件覆盖。

## 升级（提示式更新）

客户端每天最多检查一次更新（本地时间戳记录，检查失败静默跳过，不影响离线使用）。检查地址由环境变量 `HESORA_UPDATE_URL` 注入（默认留空＝关闭更新检查）：

```bash
HESORA_UPDATE_URL=https://updates.example.com/hesora/latest.json
```

发布新版本前把该常量改为你的真实地址，并在服务器放置 `latest.json`：

```json
{ "version": "1.0.1", "notes": "修复若干问题", "url": "https://.../禾序进销存-1.0.1-setup.exe" }
```

用户端发现新版本会弹出通知，点击后用系统浏览器打开 `url` 下载新安装包，覆盖安装即可（数据不丢失）。

## 开发者指南

工具链：**Node 22**（pnpm 10+）。`pretest`/`predev` 会运行 `tools/check-node.cjs` 自动校验版本，Node 23+ 或低于 22 会直接报错退出；本机安装了多个 Node 时，把 Node 22 的目录放在 PATH 最前（或用 `HESORA_SKIP_ENV_CHECK=1` 临时跳过检查）。

```bash
pnpm i          # 安装依赖（postinstall 会为 Electron 重编译 better-sqlite3）
pnpm dev        # 开发模式
pnpm test       # Vitest 单测（内存库）
pnpm dist       # 打包 Windows NSIS 安装包 → dist/禾序进销存-<版本>-setup.exe
pnpm dist:release         # 发布打包（含发布环境校验，不强制代码签名）
pnpm dist:release:signed   # 购买代码签名证书后使用（forceCodeSigning，无证书会打包失败）
```

注意：

- better-sqlite3 原生模块与运行时 ABI 绑定：Node 22 需要 ABI 127、Electron 33 需要 ABI 130。跑过 `pnpm dist` 后如需再跑单测，按提示执行 `pnpm rebuild better-sqlite3`（或 `node tools/prepare-windows-native.cjs` 的反向操作）；报 `NODE_MODULE_VERSION` 不匹配即为此原因。
- Windows 打包会准备并验证 Electron 版本的 SQLite 原生模块。打包后在 Node 22 中运行 `pnpm rebuild better-sqlite3`，恢复 Node 单测所需的模块。
- 打包后可在工作区根目录执行 `node zhjs-erp-e2e/hesora-smoke.js`。冒烟脚本使用临时账套，检查启动、登录、商品保存和品牌界面；通过 `HESORA_SCREENSHOTS` 指定截图输出目录。
- winCodeSign 缓存偶尔解压失败，可到 `%LOCALAPPDATA%/electron-builder-cache/winCodeSign` 手动 7za 解压后重试。

## 发布清单（Checklist）

- [x] `package.json build.files` 仅包含 `out/**/*`，**不含 `tools/`** —— `tools/activation-server/private.pem` 不会进入安装包
- [ ] 打包后检查 `dist/win-unpacked/` 内无 `private.pem`
- [ ] migrations 001-005 已随包打入 `resources/migrations`
- [ ] `pnpm test` 全绿、`pnpm typecheck:node` / `pnpm typecheck:web` 通过
- [ ] 安装包启动冒烟：进程可启动、数据库可建立、登录页可见
- [ ] 修改 `src/main/update.ts` 的 `UPDATE_URL` 为真实更新地址
- [x] 禾序 SVG、PNG、Windows ICO 已接入界面与安装配置；兼容保留历史 appId 和账套路径
