# AGENTS.md — zhjs-erp 项目工程规约

> 本文件对所有 AI 代理与人类协作者生效。任何代码生成、审查、提交前先读本文件。
> 设计文档：`../docs/superpowers/specs/2026-11-07-zhjs-erp-design.md`
> 实施计划：`../docs/superpowers/plans/`（P1-P4）

## 1. 项目定位

面向个人商户/中小企业的**完全离线**进销存 Windows 桌面商用软件（Electron + Vue3 + TypeScript + SQLite）。数据归用户，可同步至云盘。正向商业软件——**不是**对任何现有软件的复制。

## 2. 技术栈（硬约束，不得擅自替换）

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 33+ | 单机起步；业务层不依赖 Electron 以预留局域网多机 |
| 前端框架 | Vue 3.4+（Composition API + `<script setup>`） | UI 组件库 **Element Plus 2.x**，状态 **Pinia** |
| 语言 | TypeScript 5.x（strict 模式），全栈同语言 | 禁止 `any`（确需时用 `unknown` + 收窄并注释原因） |
| 构建 | electron-vite + electron-builder（NSIS） | — |
| 数据库 | better-sqlite3，单文件明文，WAL 模式 | 迁移用 user_version 版本号机制 |
| 测试 | Vitest（服务层单测，内存库） | 业务核心必须 TDD |
| 激活服务 | Node + SQLite（`server/` 目录，独立部署 VPS） | — |

## 3. 禁止项（红线，违反即打回）

1. **禁止复制逆向目标（智慧记/ZhjSpace）的任何源代码、二进制资源、图标、图片、字体、文案、样式表。** 逆向文档（`zhjspace/docs/`）仅用于理解业务概念与交互流程；所有代码、UI、命名、素材必须原创。
2. **禁止使用原版的品牌元素**：名称（智慧记/ZhjSpace/金蝶）、logo、配色方案（如 #062051 标题栏色）、单据类型码原文可参考语义但编号体系须自定义并注释含义。
3. **禁止把业务逻辑写进渲染层**：渲染层只做展示与交互，业务规则一律在 `src/main/services/`。
4. **`src/main/services/` 内禁止 import 任何 Electron 模块**（`electron`、`@electron/remote` 等）——这是"局域网多机预留"的架构红线。依赖只允许：better-sqlite3、`src/shared/`、Node 内置模块。
5. **禁止在渲染层直接触碰文件系统/数据库**；一切经 IPC。
6. **禁止引入云端依赖**：不接任何第三方云账号/统计/上报 SDK。
7. **禁止跳过测试提交业务逻辑**：服务层改动必须带对应 Vitest 用例。
8. **禁止明文记录激活码/机器码原文到日志**。

## 4. 代码规约

- 统一返回值 `Result<T>`（`src/shared/result.ts`），IPC handler 一律经 `wrapHandler` 注册；业务错误抛 `BizError(code, msg)`，禁止裸 throw string。
- 服务层组织：`src/main/services/<域>/<域>.service.ts`，工厂函数 `createXxxService(db)` 注入数据库，便于内存库测试。
- 数据库：所有库存变动必须走 `inventory + cost_log`；金额字段用 REAL（元，两位小数由展示层控制）；一切多表写入用 `db.transaction`。
- 提交信息：`feat:|fix:|chore:|test:|docs:` 前缀 + 英文简述。
- 文件命名：组件 PascalCase，其余 camelCase / kebab-case 目录。

## 5. 产品特色要求（不只是"能用"）

- **有自己特色**：界面允许借鉴行业通用交互（单据列表→编辑→审核），但视觉与文案必须有自己的设计语言；禁止模仿竞品截图级相似。
- **生产可用标准**：
  - 每个用户可见操作有明确成功/失败反馈（ElMessage），失败信息说人话（"库存不足：可乐 330ml 剩 5 件"，不是"error -1"）。
  - 危险操作（删单、反审核、恢复备份）必须二次确认并写操作日志。
  - 启动时间 < 3s；万级商品搜索 < 50ms（本地索引）。
  - 数据库任何写操作失败不得留下半截数据（事务保证）。
  - 卸载重装/升级不丢数据（数据在 userData，迁移可回溯）。
- **离线优先**：所有功能在断网下完整可用；联网仅用于激活与更新检查，失败必须静默或可跳过。

## 6. 工程流程

- 实施按 `docs/superpowers/plans/` 的 P1→P4 顺序；每任务 TDD：失败测试 → 实现 → PASS → commit。
- 每个 Plan 的"验收标准"全绿才算完成。
- 新增依赖需在 PR/提交说明中给出理由（YAGNI：能用内置/已有依赖解决就不加）。
