# 禾序进销存（hesora-inventory）架构审计总文档

> 审计基准：`../docs/superpowers/specs/2026-11-07-zhjs-erp-design.md` + P1-P4 计划 + 逆向参考底账 `audit-reference-routes.md`（196 页）。
> 审计日期：2026-11-07。基线 commit：22ffbc7 之后。
> 分项审计见：`audit-p3.md`（P3 打印/CSV）、`audit-p4.md`（P4 平台）、`audit-reference-routes.md`（逐页对照）。

## 一、总体结论

以下是已覆盖模块的索引。整体等价与正式发行仍未通过验收，当前运行证据和差距见 [1.1.0 候选包验收记录](acceptance-v1.1.md)。

后续实测见 [采购、销售与资金核对](audit-settlement.md)、[订单履行核对](audit-fulfillment.md) 和 [云盘同步与恢复核对](audit-sync.md)。

实机复跑使用 [业务流程验收手册](business-acceptance-playbook.md)。

| 维度 | 状态 | 说明 |
|---|---|---|
| P1 骨架+主档+库存 | ✅ 完成 | 脚手架/DB/Result/商品/客商/仓库资金/设置/库存加权/期初/统计/打包 11 任务 |
| P2 单据引擎 | ✅ 完成 | 13 类单据 + 调拨/盘点/组装拆卸/收付款/应收应付/退货 + 集成冒烟 |
| P3 报表打印 | ✅ 完成 | 仪表盘/热敏小票/A4 PDF/CSV 导入导出/单据查询中心 |
| P4 平台 | ✅ 完成 | 备份/云盘同步/引导/权限/试用激活/提示更新/1.0.0 发布 |
| RBAC 角色权限 | ✅ 补齐（本轮） | 自定义角色 CRUD + 权限矩阵 UI + 通道级权限映射 + 用户分配角色 |
| 多 TAB 页布局 | ✅ 补齐（本轮） | 每路由一 TAB + 关闭/批量关闭 + keep-alive |
| 价格等级/保质期/批次 | ✅ 补齐（本轮） | product_price 全链路 + shelf_life + product_batch |
| 库存明细报表 | ✅ 补齐（本轮） | 库存明细/成本变动/库存流水/库存预警/调整售价 |
| 序列号台账 | ✅ 补齐（本轮） | serial_number/serial_flow + 入库登记/出库核销/预校验 |
| 单据复制（再来一单） | ✅ 补齐（本轮） | copy.service + doc:copy 通道 |
| 待办（上架前） | ⏳ | E2E UI 冒烟、最终安装包、README 截图 |

## 二、设计 vs 实现对照（要点）

### 2.1 单据（设计 14 类 → 实现 13 类 doc + 3 类 workflow）

- ✅ 13 类直接过账单据：purchase/sale/retail/purchase_return/sale_return/transfer/stocktake/assemble/disassemble/receipt/payment/other_out/other_in（migrations/002，doc.service）。
- ✅ 报价单/销售订单/采购订单走 doc_workflow（010），支持 quote→sale_order→sale、purchase_order→purchase 转换链（workflow.service，approve 仅对 sale/purchase 过账）。
- ✅ 单据完成（done）后禁改禁删；退货单通过 source_doc_id（014）关联原单。

### 2.2 库存（移动加权 + 多仓 + 批次 + 序列号 + 效期）

- ✅ inventory + cost_log 双表，移动加权成本；applyChanges 单事务（inventory.service，355 用例中 10+ 用例覆盖）。
- ✅ 批次分仓：inventory UNIQUE(product_id,warehouse_id,batch_no)。
- ✅ 序列号：serial_number 台账 + serial_flow 流水（018），registerIn/consumeOut/validateSns 预校验（serial.service）。
- ✅ 保质期：product.shelf_life_days + product_batch 效期（016），保质期查询页 + 临期/过期统计（shelf-life.service）。

### 2.3 报表（设计 9 种 → 实现）

- ✅ 经营仪表盘（sales/retail/receipt/payment/stock_amount/应收应付 + 趋势）
- ✅ 应收应付（fund_flow.partner_id 自 022 起记录往来归属，退货冲减应收/应付已修复，见 tests/unit/return-arrears.test.ts）
- ✅ 经营报表 BusinessReportView（7 种 REPORT_LABELS：sales/purchases/profit/fund/hot/stockSheet/stocktake）
- ✅ 单据查询中心（13 类型过滤 + partner_name + 条件打印）
- ✅ 库存明细/成本变动明细/库存流水/库存预警（stock-report.service，017）
- ⚠️ 客户对账明细与账龄、员工业绩：未实现（逆向 #146/#147/#150），留待 1.2。

### 2.4 打印

- ✅ 58/80mm 热敏小票（webContents.print 静默）+ A4 printToPDF（含保存对话框）。
- ⚠️ 打印模板编辑器：未实现，模板为代码内置（templates.ts）；逆向 #127 打印模板管理留待 1.2。

### 2.5 权限（设计 ~40 点 → 实现 47 点）

- ✅ PermissionKey 47 个 + PERMISSION_GROUPS 8 组（单测保证不重不漏）。
- ✅ 内置 admin/cashier 不可改删；自定义角色存 access_role 表（015）；ADMIN_ONLY 权限恒拒自定义角色。
- ✅ 通道级 PERMISSION_MAP（~140 通道）+ 默认守卫 NO_PERMISSION。
- ✅ RoleListView 权限矩阵（分组勾选/半选态）+ UserListView 分配自定义角色。
- ⚠️ op_log 操作日志：platform_log（012）仅记录关键动作（备份恢复/权限变更等），未覆盖全部单据操作；危险操作（删单/反审核/恢复备份）已二次确认。

### 2.6 平台

- ✅ 试用 7 天（全功能、无延期、到期只读）+ Ed25519 激活码（公钥内嵌，私钥仅 tools/activation-server，不入安装包）。
- ✅ 备份（手动+启动自动保留 10 份+恢复前安全副本+relaunch）；云盘同步（WebDAV/本地目录，先备份后同步）。
- ✅ 提示式更新：默认内置双渠道（Gitee 优先 / GitHub 回退，失败才回退；`HESORA_UPDATE_GITEE_URL` / `HESORA_UPDATE_GITHUB_URL` 可覆盖，旧 `HESORA_UPDATE_URL` 兼容单渠道）；仅提示并打开下载页，不自动下载/安装；固定 tag=`latest`、附件名 `hesora-inventory-setup.exe`（详见 docs/update-channels.md）。
- ✅ 数据目录迁移：zhjs-erp → hesora-inventory（profile.ts，含占用回退）。

## 三、已知限制（上架可接受，1.2 迭代）

1. ~~应收应付不含退货冲减（fund_flow 无 partner_id）~~ → 已修复（migration 022_fund_flow_partner.sql，退货流水带 partner_id 并计入往来冲减）。
2. 打印模板内置不可编辑。
3. 客户对账明细/账龄、员工业绩报表缺失。
4. 单据审核流仅 workflow 表 3 类（quote/order），13 类直过账单据无审核位。
5. 快速开单挂单已实现（retail:hold），但无挂单恢复快捷键。
6. 默认 Electron 图标已换（hesora.ico），未做代码签名（安装时会提示未知发布者）。

## 四、上架前检查清单

- [x] private.pem 不入仓库/安装包（c265dc0 已验证 dist 无私钥）
- [x] build.files 不含 tools/
- [ ] pnpm dist（1.1.0）+ 启动冒烟（hesora-smoke.js）
- [ ] README 更新 1.1.0 功能清单
- [ ] 最终 typecheck+vitest 全绿
