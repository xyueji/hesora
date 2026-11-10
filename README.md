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
- **试用**：首次运行即 7 天全功能试用（含专业版功能，无延期），到期转只读，激活后恢复

## 安装

1. 双击 `禾序进销存-1.1.0-setup.exe`，按向导选择安装目录即可。
2. 升级前先备份并退出旧版程序。禾序首次打开时会把旧数据目录 `%APPDATA%\zhjs-erp` 整体迁移为 `%APPDATA%\hesora-inventory`（账套、备份与设置原样保留），账套文件同时改名为 `hesora-inventory.db`。
3. 首次启动时设置本地管理员与密码。旧版若仍在使用初始管理员密码，会提示设置新密码。

安装向导会在**桌面默认创建「禾序进销存」快捷方式**（开始菜单同时创建），无需额外勾选。安装完成后**不再自动启动程序**（点「完成」安装器立即退出，避免等待应用冷启动）；想立即使用，请双击桌面快捷方式打开。首次启动时会先显示「正在启动…」过渡页，等数据库与界面准备完成后自动切换到主窗口，属正常现象。

正式账套首次打开为空。用 `禾序进销存.exe --demo` 可打开独立演示账套，包含模拟商户资料和贯穿采购、销售、库存及资金的业务单据。演示账套在窗口内标记为「模拟数据」，账套目录为 `%APPDATA%\hesora-inventory-demo`。

## 试用与激活

- 未激活状态下首次运行开始 **7 天全功能试用**（含专业版功能，无延期）；到期后进入只读模式（业务单据暂停新增与修改，查看、导出与备份不受影响），激活后恢复。
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

客户端每天最多检查一次更新（本地时间戳记录；检查失败静默跳过，不影响离线使用）。
采用 **Gitee 优先、GitHub 回退** 的双渠道：按顺序拉取 `latest.json`（Gitee 优先），
渠道失败（网络异常 / 非 2xx / JSON 非法 / 字段非法 / 下载链接不在白名单）才回退 GitHub；
渠道有效但无更新则立即结束、不再回退。两处 manifest 必须同步为同一版本。

> 官方发布渠道（Gitee / GitHub 的 `xyueji/hesora`）**仅用于分发安装包与更新清单，
> 不提供源码、禁止推送源码**；本地开发仓库不配置任何 git remote。

检查地址默认内置（可被环境变量覆盖）：

| 变量 | 默认值 |
|---|---|
| `HESORA_UPDATE_GITEE_URL` | `https://gitee.com/xyueji/hesora/raw/main/latest.json` |
| `HESORA_UPDATE_GITHUB_URL` | `https://raw.githubusercontent.com/xyueji/hesora/main/latest.json` |
| `HESORA_UPDATE_URL` | 兼容单渠道覆盖（设置后作为唯一渠道） |

发布规范：release tag 恒为 `latest`、附件名恒为 `hesora-inventory-setup.exe`，
每次发版覆盖同一 tag 的附件；两个仓库 `main` 分支的 `latest.json` 同步为同一版本
（`version` 递增、`sha256` 必填、`url` 可省略）：

```json
{ "version": "1.0.1", "notes": "修复若干问题", "sha256": "<64 位 hex>" }
```

`url` 省略时，客户端按固定 tag + 固定包名拼接 Gitee release 附件地址；下载链接主机受
域名白名单约束（github.com / *.githubusercontent.com / github.io / gitee.com / *.gitee.com / gitee.io）。
`sha256` 在更新提示里展示前 8 位并支持复制全文，供下载后核对完整性。

用户端发现新版本会弹出通知，点击后用系统浏览器打开**固定下载地址**下载安装包，
**手动运行覆盖安装**（数据不丢失）。这是「提示式更新」，**不自动下载/安装**；
真正一键自动更新需二期引入 electron-updater + 代码签名。

详见 [更新渠道配置](docs/update-channels.md)。

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
- [ ] 按 [更新渠道配置](docs/update-channels.md) 在 Gitee / GitHub 同步 `latest.json` 与 `tag=latest` 附件；`HESORA_UPDATE_GITEE_URL` / `HESORA_UPDATE_GITHUB_URL` 默认已内置真实地址，通常无需改动
- [x] 禾序 SVG、PNG、Windows ICO 已接入界面与安装配置；兼容保留历史 appId 和账套路径

## Windows SmartScreen 首次运行提示（未签名安装包）

当前发布的 Windows 安装包**未做代码签名**，首次运行时 Windows SmartScreen 会弹出"Windows 已保护你的电脑"蓝色提示。这是对无签名程序的通用提醒，不代表发现病毒。安装包已公布 SHA256 校验值，请核对后再运行。

### 首次运行步骤

1. 双击运行 `禾序进销存-<版本>-setup.exe`，弹出 SmartScreen 蓝色窗口：**"Windows 已保护你的电脑"**。
2. 点击窗口中的 **"更多信息"** 链接（蓝色小字，位于提示文字下方）。
3. 提示展开后，右下角出现 **"仍要运行"** 按钮，点击它即可继续安装。
4. 后续安装流程与普通安装程序一致；之后再次启动不会再出现该提示。

> 截图占位：SmartScreen "更多信息 / 仍要运行" 界面（待补充实际截图）

### 核对安装包 SHA256

发布渠道会公布安装包的 SHA256 校验值。下载后在 PowerShell 或命令提示符中执行：

```powershell
Get-FileHash "禾序进销存-1.3.0-setup.exe" -Algorithm SHA256
```

或在 Git Bash / Linux 下：

```bash
sha256sum 禾序进销存-1.3.0-setup.exe
```

当前发布版本核对值：

| 安装包 | SHA256 |
|---|---|
| `dist/禾序进销存-1.3.0-setup.exe` | `5129da58ff5d512cbd638d445a21394a39609bd1749712edb4594154a4716e72` |

### 下载安全建议

- 请始终从**官方渠道**（本仓库 Release 页或官方指定站点）下载安装包，不要使用第三方下载站的转载。
- 下载后先核对上表 SHA256 值，一致再运行；不一致说明文件被篡改或不是官方版本，请勿运行。
- 购买代码签名证书后，发布流程会切换到 `pnpm dist:release:signed`，届时 SmartScreen 提示将随签名信誉积累消失。
