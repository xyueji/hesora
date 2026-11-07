# 禾序进销存 · HESORA Inventory

**货有数，账有序。** 禾序是一款面向商户与中小企业的 Windows 本地进销存软件，让进货、销售、库存和往来账目清楚有序。日常业务在本机运行，经营数据默认存放于本机，可按需备份、恢复与导出。

[品牌说明与视觉规范](../docs/brand/品牌说明.md)

## 功能清单

- **商品**：商品档案（分类/规格/条码/进价/售价）、启用停用、CSV 批量导入
- **库存**：多仓库、库存查询/汇总、成本流水（cost_log）、组装拆卸、调拨、盘点
- **单据**：进货/进货退货、销售/销售退货、采购退货、快速零售、收款/付款单，单据查询与明细
- **报表**：首页经营概览、近 7 日趋势、应收应付汇总
- **打印**：小票打印（可选打印机）、A4 出货单导出 PDF
- **同步/备份**：手动备份/恢复、自动备份，WebDAV 或本地目录云盘同步（上传/下载/从云端恢复）
- **权限**：admin / cashier 双角色，菜单与操作级权限控制，多用户管理
- **试用**：首次运行即 15 天全功能试用，激活后永久使用

## 安装

1. 双击 `禾序进销存-1.0.0-setup.exe`，按向导选择安装目录即可。
2. 升级前先备份并退出旧版程序。禾序首次打开时将原数据目录 `%APPDATA%\zhjs-erp` 中的 `zhjs-erp.db` 改名为 `hesora-inventory.db`，已有业务记录和本地设置随账套保留。
3. 默认管理员：**admin / admin123**，⚠️ 登录后请立即在「用户管理」中修改密码。

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

## 升级（提示式更新）

客户端每天最多检查一次更新（本地时间戳记录，检查失败静默跳过，不影响离线使用）。检查地址是编译期常量：

```ts
// src/main/update.ts
export const UPDATE_URL = 'https://updates.example.com/zhjs/latest.json'
```

发布新版本前把该常量改为你的真实地址，并在服务器放置 `latest.json`：

```json
{ "version": "1.0.1", "notes": "修复若干问题", "url": "https://.../禾序进销存-1.0.1-setup.exe" }
```

用户端发现新版本会弹出通知，点击后用系统浏览器打开 `url` 下载新安装包，覆盖安装即可（数据不丢失）。

## 开发者指南

工具链：**Node 22**（Windows 下建议固定 PATH 指向 Node 22，pnpm 10+）。

```bash
pnpm i          # 安装依赖（postinstall 会为 Electron 重编译 better-sqlite3）
pnpm dev        # 开发模式
pnpm test       # Vitest 单测（内存库）
pnpm dist       # 打包 Windows NSIS 安装包 → dist/禾序进销存-<版本>-setup.exe
```

注意：

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
