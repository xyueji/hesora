# v1.3.0 验收记录（LAN 协作 + 加密备份）

对照 spec `docs/superpowers/specs/2026-11-09-v1.3-pro-lan-spec.md` §10 T1–T10。
测试基线：**95 个测试文件 / 745 用例全绿 + typecheck（node & web）双绿**（v1.3 Task 9 收尾时点）。

| # | 验收项 | 结论 | 证据 |
|---|--------|------|------|
| T1 | 主机服务路由与权限 | ✅ 通过（自动） | `tests/unit/host-server.test.ts`（20 用例）：/health/live、/pair/start 限流、/pair/result 各状态、/rpc/:channel 401（无 token / HMAC 错 / 时钟偏移 E_CLOCK_SKEW / 重放 E_REPLAY）、E_LOCAL_ONLY、E_HOST_ONLY、PERMISSION_MAP 权限分支，全部经 fastify.inject + 内存库断言 |
| T2 | 配对时序 | ✅ 通过（自动） | `tests/unit/host-pairing.test.ts`：6 位码生成、5min TTL 过期、一次性消费、店长拒绝、假时钟推进；`tests/unit/host-server.test.ts` /pair/result granted/denied/expired/pending 分支；`tests/unit/host-pair-ipc.test.ts` pairStart/pairGrant/pairDeny/revokeDevice |
| T3 | 幂等重放 | ✅ 通过（自动） | `tests/unit/host-idempotency.test.ts` + `tests/unit/host-gateway.test.ts`：同 X-Request-Id 重放返回缓存结果（业务只生效 1 次）；`hesora-lan-e2e.js` 断言「幂等重放同结果」实际双实例验证 |
| T4 | 并发库存竞争 | ✅ 通过（自动） | 单测：sale.service 并发用例；E2E：`zhjs-erp-e2e/hesora-lan-e2e.js`「并发卖最后一件：恰一个成功 (oks=1)」+「失败方 NOT_ENOUGH」，better-sqlite3 串行化保证无负库存无半截单据 |
| T5 | INVBAK 往返 | ✅ 通过（自动） | `tests/unit/invbak.test.ts` + `tests/unit/invbak-service.test.ts`：加密备份→改库→恢复→关键表比对；口令错/版本过高/校验失败明确拒绝（Task 7 完成，48 用例相关域全绿） |
| T6 | WS 通知 | ✅ 通过（自动） | `tests/unit/host-events.test.ts`（11 用例）：subscribe 校验、subscribed 回执、doc.changed 权限门控（doc.viewAll / inventory.report）、summary-only 剥离、心跳；E2E：「主机 WS doc.changed 到达客户端」「WS inventory.changed 到达」双实例实测 |
| T7 | 会话生命周期 | ✅ 通过（自动） | `tests/unit/host-auth.test.ts`：48B token、8h 滑动 TTL（假时钟）、吊销后 validateSession=null、nonce 防重放；E2E /auth/session 成功 + 错误密码 E_LOGIN_FAILED 实测 |
| T8 | 双实例 E2E | ✅ 通过（自动） | `zhjs-erp-e2e/hesora-lan-e2e.js`（exit 0，28 项断言全 PASS）：主机实例（pro/lan 授权，18650 监听）+ 客户端实例（独立 --user-data-dir），完整流程：配对码获取 → 主机确认 → secret 一次性下发与失效 → /auth/session → WS 订阅 → LAN sale:create（单号 XS202611100001）→ WS doc.changed/inventory.changed 到达 → 并发卖最后一件恰一成功一 NOT_ENOUGH → 幂等重放同结果 |
| T9 | 备份不阻断收银 | ✅ 通过（自动） | `tests/unit/backup.service.test.ts`：备份与业务写入并发（backup 异步导出不持长事务）；INVBAK 恢复流程独立于收银通道 |
| T10 | 基础版零开销 | ✅ 通过（自动） | `zhjs-erp-e2e/hesora-t10-zero-cost.js`（exit 0，7/7 PASS）：standard 授权（无 lan_collaboration）下 host:status 返回 `{enabled:false, port:0, deviceCount:0, uptimeMs:0}`、18650 端口无监听（net 探测）、无多余窗口/Tray 门控未触发；单测侧 `tests/unit/host-server-lazy.test.ts` 证明 fastify/ws 仅在双条件满足时动态 import（未启用时零加载） |

## 打包冒烟（v1.3.0）

- 顺序（运维教训固化）：`@electron/rebuild -f -w better-sqlite3 -v 33.4.11 --arch x64` → `electron-builder --win` → 冒烟 → 跑 vitest 前 `pnpm rebuild better-sqlite3`（Node ABI）。
- 冒烟：`zhjs-erp-e2e/hesora-smoke-130.js` PASS——win-unpacked exe（临时 user-data-dir）主窗口出现、存活 6s 无崩溃。
- 产物：
  - 安装包 `dist/禾序进销存-1.3.0-setup.exe`（86,573,026 B），SHA256 `5129da58ff5d512cbd638d445a21394a39609bd1749712edb4594154a4716e72`
  - 主程序 `dist/win-unpacked/禾序进销存.exe`，SHA256 `d8dea3d302087642ca3d678f672b2064ee25e038300ab8b6873b10d74a2b5113`

## 本轮修复的缺陷（验收中发现）

1. `license.service.ts parseCode` 丢弃 edition/features/maxDevices → hasFeature 恒 false，LAN 主机永不启动（commit 220047c）。
2. `@peculiar/x509` 纯 ESM 被 externalizeDepsPlugin 外置 → 打包后 LAN 初始化 ERR_REQUIRE_ESM；改为 bundle 进 CJS chunk（commit a47a39c）。
3. HTTP `/pair/start` 不进 host:pairPending UI 列表 → 新增 onPairRequest 桥接（commit a47a39c）。
4. spec §5.5 `/auth/session` 端点缺失 → 实现并接线 sessionLogin（commit 6044ebd）。

## 已知限制 / 待真机验收

- 跨物理机（非 127.0.0.1）配对、真实路由器/防火墙环境、多客户端并发连接：**待真机验收**（E2E 与冒烟均在本机双实例完成）。
- 时间同步依赖（x-ts ±120s 窗口）依赖各机 NTP 校时，无内建校时提示（spec R4）。
- mDNS 主机自动发现未实现（spec TBD#7），当前以二维码/输码配对。
- 试用版是否含 LAN 的商业决策未定（spec TBD#1）；当前试用版不含 lan_collaboration feature。
- 卸载/重装后设备 secret（DPAPI 加密）随 profile 保留；跨机器迁移需重新配对（设计如此）。
