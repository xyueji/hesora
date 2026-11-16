# 功能差距分析（最终版）：逆向参考（智慧记 renderer-web）vs 禾序进销存 v1.1.0

> 日期：2026-11-09
> 逆向参考：`../zhjspace/renderer-web/web/`（页面 chunk）、`renderer-web/mock/data.mjs`（94 个端点注册）、`../zhjspace/docs/04-功能清单.md`、`docs/09-完整功能地图（真实前端）.md`
> 本系统：hesora-inventory v1.1.0，逐页对照底账 `audit-reference-routes.md`（196 路由）、架构审计 `audit-master.md`
> 另合并：`excel-template-comparison.md`（Excel 模板对比，第三节直接摘取）
> 定位过滤：已剔除云端账号、多机构、微商城、营销推送、广告/模板市场等与「完全离线个人商户」冲突项（见第四节）。

## 一、逆向参考 vs 本系统 差距清单（按价值排序）

价值判断依据个人商户实际经营场景；工作量 S（≤1 天）/ M（2-5 天）/ L（>1 周）。

| # | 功能 | 逆向出处 | 价值 | 工作量 | 说明 |
|---|---|---|---|---|---|
| 1 | 客户/供应商**对账单明细 + 账龄分析** | `/report/receivable-list`、`/report/receivable-detail`、`/report/payable-list`、`/report/payable-detail`（audit-reference-routes #146-#149） | 高 | M | audit-master 2.3 已确认缺失（「留待 1.2」）。逐单核销已有，但缺"某客户全部往来明细一张单"与 30/60/90 天账龄区间。个人商户催款刚需 |
| 2 | **订金/预存款管理**（预收订金、订金抵扣、预存款抵扣收款） | `bill_row.deposit_amt/prepaid_amt/surplus_deposit_amt`、收款单列表"预存款抵扣"列（audit #49-#56；mock data.mjs `billRow`） | 高 | M | audit #49 明确"预存款待补"。零售/批发收订金是高频场景（定做、赊销担保） |
| 3 | 单据**图片附件**（拍照留证，盘点单/单据行图片） | 盘点单可见表头"图片附件"（audit #40-#42）、`billRow.pictures`（mock） | 中高 | M | 离线可做：图片存 userData 附件目录。盘点差异留证、送货签收拍照对个人商户实用 |
| 4 | **首页重要提醒聚合**（待收款/待付款/库存预警/临期汇总入口） | mock `report/homepage/query/important/remind`（type 1 库存预警、type 2 待收款）；`report/sale/query/homepage/indicator`（指标卡 + 同比环比 last_value/rate） | 中高 | S-M | 本系统仪表盘有趋势，缺"提醒清单"卡片与同比环比指标。S 版本：把已有预警/应收数据聚合成提醒卡片 |
| 5 | **客户/供应商分类分组**（普通客户/批发客户等自定义类别） | `/customer/price-level` 相邻、mock `baseinfo/(customer\|supplier)type/query/list`（audit #97-#105 "分组需核对"） | 中 | S | partner 表加 category 字段 + 过滤即可。批发/零售客户区分定价、筛选高频使用 |
| 6 | **商品自定义属性**（颜色/尺码等 SELECT/INPUT 属性，可参与筛选） | `/product/attributes`（audit #141）、mock `baseinfo/customattribute/query/list`（"颜色→红/蓝"） | 中 | M | 本系统仅规格文本；服装/鞋类个人商户常需要属性筛选。可先做"自定义字段 + 列表筛选" |
| 7 | **单据快递信息本地登记**（快递公司 + 运单号字段、发货状态） | 单据字段 `express_num/express_com/delivery_status`（mock billRow）、audit #1 "发货状态需对照" | 中 | S | 不接快递 100（外网），仅本地记录运单号 + 发货状态标记。做电商发货的个人商户高频 |
| 8 | **发票状态标记**（未开票/已开票） | `invoice_status/invoice_status_name`（mock billRow） | 中 | S | 单据加枚举字段 + 列表筛选。开票记账是个人商户月结刚需，S 工作量 |
| 9 | **按客户/按商品维护的报价体系**（价格管理两视角） | `/customer/quotation-management/add-from-company`、`add-from-product`（audit #106-#108） | 中 | M | 本系统有客户专属价+价格等级，缺"以客户为中心看其全部协议价 / 以商品为中心看各客户价"的管理视图 |
| 10 | **提成规则设置**（按销售额/利润百分比提成，逐单算提成） | mock `system/commission/rule/query/list`、`report/commission/query/list`（audit #119-#120"原设计移除，需确认"） | 中 | M | 本系统有员工业绩报表，缺提成规则与提成金额列。单人店价值低，雇 1-2 人店有用。可降级为报表里加提成率列（S） |
| 11 | **13 类直过账单据的审核位**（制单→审核→过账） | audit-master 已知限制 4（参考系统草稿/审核流，audit #1"草稿审核暂为独立入口"） | 中 | M | 防误操作：老板制单、店员不能直接过账。已有 workflow 表可复用模式 |
| 12 | **收支科目/业务类别字典**（其他收支分类、单据业务类别过滤） | `/setting/set-incometype`（audit #171"待补"）、mock `report/fund/flow/query/chart`（按科目汇总收支饼图） | 中 | S | 资金流水已有，加"收支项目"字典 + 按项目汇总报表（房租/水电/工资分类） |
| 13 | **商品图片**（3 张档案图，单据/列表可选展示） | mock `baseinfo/product/query/prclist` 的 `picture1-3`、`/product/image-management`（audit #133） | 中 | M | 离线存本地。POS 选货可视化对餐饮/零售有用；纯批发价值低 |
| 14 | **打印模板多套 + 打印机设备映射** | `/setting/print-template/list`、mock `system/print/template/list`（模板↔设备绑定）、audit #127"本地模板编辑、设备映射待补" | 中 | M | 本系统模板为代码内置（audit-master 2.4）；先做"多套预设模板切换 + 指定打印机"即可满足离线定位，无需模板市场 |
| 15 | **调拨单/已过账单据的红冲与完整复制** | `/bill/copy-transfer`（audit #65-#69"已过账更正及完整复制待补"） | 中 | S | 红冲已有（销售/采购），确认覆盖调拨/盘点等全部单型并补复制入口 |
| 16 | **多币种/汇率（手动维护）** | `/setting/currency-rate`、mock `system/exchange/rate/query/list`（audit #170"原设计移除，需确认"） | (价值待定) | M | 跨境/边贸个人商户有用，纯内贸无用。建议保持不做，出现真实用户需求再做 |
| 17 | **单据操作日志全量覆盖** | `/corp/operate-log`（audit #122"完整操作审计待补"、audit-master 2.5 ⚠️） | 中低 | S | platform_log 仅记关键动作；把删单/红冲/改价等全部落 op_log 即可，UI 已有 |
| 18 | **挂单恢复快捷键** | audit-master 已知限制 5（参考收银台 `/cash/index`，audit #93-#94） | 中低 | S | retail:hold 已有，补 F2/快捷键取单 |
| 19 | **批号必录/强约束模式**（按商品开启批号必填） | `/product/batch-list`、`/product/quality-list`（audit #144-#145"批号与效期管理待补"） | 中低 | S | 批次表已有；加商品级 `batch_required` 开关，入库不填批号即报错 |
| 20 | **商品批量修改**（选中多行批量改价/改分类） | `/product/import-edit`（audit #143） | 低 | M | 已有 CSV 导入导出可覆盖大部分场景；界面上批量改价是锦上添花 |
| 21 | **单据表头业务员双签（制单人+经办人）**、**单据编号前缀可配**、**库存金额列** 等 Excel 模板来源项 | 见第二节 | 见第二节 | 见第二节 | 已在 Excel 对比文档定级，此处不重复展开 |

排除的同名"已有"项（避免误判为缺失）：商品多单位/条码/批次保质期、序列号全链路、组合商品/BOM/配方、报价→订单→分批履行、红冲、逐单核销、零售 POS、盘点 CSV 导入、调整售价、应收应付余额、员工业绩总表、RBAC、备份同步、引导。

## 二、Excel 模板对比结论（摘自 `excel-template-comparison.md`）

完整分析见该文档，此处仅摘取优化清单：

- **P1（全是 S）**：库存金额列（数量×移动加权成本）；打印模板加业务员行；销售单外部订单号字段（对接电商平台单号）；客户/供应商档案加邮箱；日报速览卡片（昨日库存→今日销量→今日入库→现库存）。
- **P2**：月度库存汇总表（期初+入库-出库=期末结存，M）；采购建议清单/补货计划（按缺量一键生成采购建议，M）；盘点复盘流（盘点人/复盘人/自动盘盈亏结论，S-M）；单据编号前缀可配（S）。
- **P3**：货架号/货位（S-M）；进出类别字典（M）；内部领用出库单类型（M，含领用人/去向）；按日历矩阵的商品×日期出入库视图（M）；安全库存双阈值（上限预警，S）；客户/供应商传真（可弃）。
- 该文档"逻辑层"结论：本系统在成本口径（移动加权+红冲对称回退）、逐单核销、事件台账不可篡改、报价闭环、RBAC 五方面已优于 Excel 模板，可作为宣传话术。

## 三、最终汇总优化路线图（两源合并去重）

去重规则：同一能力两处来源只保留一条并标注双来源；已在第一节标注"已有"的不再出现。

### P1（建议下版即做，全部 S 或小 M）

| 功能 | 来源 | 价值 | 工作量 |
|---|---|---|---|
| 客户/供应商对账单明细 + 账龄分析 | 逆向 #146-#149、audit-master 2.3 | 高 | M |
| 订金/预存款管理（预收、抵扣、余款） | 逆向 #49-#56 | 高 | M |
| 库存金额列（库存统计/明细加数量×成本列） | Excel 模板 #6 | 高 | S |
| 单据打印加业务员行、单据编号醒目 | Excel 模板 #4/#6 | 中 | S |
| 销售单外部订单号字段（电商单号） | Excel 模板 #2 | 中 | S |
| 客户/供应商档案加邮箱字段 | Excel 模板 #5 | 中 | S |
| 日报速览卡片（昨日库存/今日销量/今日入库/现库存） | Excel 模板 #2 | 中 | S |
| 首页重要提醒聚合（待收付/库存预警/临期） | 逆向 mock `important/remind` | 中高 | S-M |
| 发票状态标记（未开票/已开票 + 筛选） | 逆向 mock `invoice_status` | 中 | S |
| 客户/供应商分类分组 | 逆向 mock `customertype` | 中 | S |
| 收支科目字典 + 按科目资金汇总 | 逆向 `/setting/set-incometype` | 中 | S |
| 单据快递公司/运单号本地登记 | 逆向 mock `express_num` | 中 | S |

### P2（下下版）

| 功能 | 来源 | 价值 | 工作量 |
|---|---|---|---|
| 月度库存汇总表（逐月期初/入库/出库/结存） | Excel 模板 #1/#7 | 高 | M |
| 单据图片附件（盘点/单据拍照留证，本地存储） | 逆向 audit #40-#42 | 中高 | M |
| 按客户/按商品双视角报价管理 | 逆向 audit #106-#108 | 中 | M |
| 采购建议清单（按安全库存缺量一键生成） | Excel 模板 #8 | 中 | M |
| 盘点复盘流（复盘人/自动盘盈亏结论） | Excel 模板 #5/#6 | 中 | S-M |
| 单据编号前缀可配置 | Excel 模板 #6 | 中 | S |
| 13 类直过账单据审核位 | 逆向（audit-master 限制 4） | 中 | M |
| 商品自定义属性（属性字典+筛选） | 逆向 `/product/attributes` | 中 | M |
| 打印模板多套预设 + 打印机设备映射 | 逆向 audit #127 | 中 | M |
| 全部单型红冲/复制补齐（调拨/盘点等） | 逆向 audit #65-#69 | 中 | S |
| 操作日志全量覆盖单据危险操作 | 逆向 `/corp/operate-log` | 中低 | S |

### P3（视需求）

| 功能 | 来源 | 价值 | 工作量 |
|---|---|---|---|
| 货架号/货位字段（商品级） | Excel 模板 #5/#8 | 中 | S-M |
| 进出类别字典（采购入库/领用/报废…报表可过滤） | Excel 模板 #6 | 中 | M |
| 内部领用出库单类型（领用人/去向） | Excel 模板 #10 | 中 | M |
| 商品图片（本地 1-3 张） | 逆向 `/product/image-management` | 中 | M |
| 提成规则设置/提成列（或先仅报表加提成率） | 逆向 mock `commission/*` | 中 | M |
| 按日历矩阵的商品×日期出入库视图 | Excel 模板 #7 | 中低 | M |
| 安全库存双阈值（超储上限预警） | Excel 模板 #6/#8 | 中低 | S |
| 批号必录开关（按商品） | 逆向 audit #144-#145 | 中低 | S |
| 挂单恢复快捷键 | 逆向收银台 audit #93-#94 | 中低 | S |
| 商品批量修改（批量改价/分类） | 逆向 `/product/import-edit` | 低 | M |
| 多币种/汇率（手动维护）(价值待定) | 逆向 `/setting/currency-rate` | 待定 | M |

统计：差距清单第一节 21 条 + Excel 摘录 17 条，合并去重后最终 **P1 12 条、P2 11 条、P3 11 条**。

## 四、明确不做项及理由（离线定位冲突的逆向功能）

| 逆向功能 | 出处 | 不做理由 |
|---|---|---|
| 云店/微商城全套（装修、商品标签、商城订单、微信支付绑定） | `/wemall/*` 11 路由（audit #186-#196）、`wemall.*.js` chunk | 依赖云端商城与微信支付，与完全离线定位冲突 |
| 微信自动通知、微信自动化 | `/customer/wechat-notify`（audit #96） | 需微信服务号云服务 |
| 智能海报/生成海报（创客贴云设计） | `/bill/poster/*`（audit #91-#92）、mock `chuangkit/*` 端点 | 依赖创客贴云服务；属营销推送场景 |
| 模板商城（打印模板市场、已购模板） | `/template-mall/*`（audit #128-#130）、mock `system/print/market/*` | 云市场付费分发；本地改为"多套内置预设模板"覆盖真实需求（见 P2） |
| 快递 100 在线下单/轨迹查询 | `/express/send`（audit #124）、mock `kuaidi100/*` | 需外网 API；本地仅保留运单号登记（P1 已含） |
| 应用市场/产品动态/会员营销 | `/applications/list`（audit #126）、mock `application_web` 配置 | 云端内容分发与营销 |
| 多门店/POS 设备管理/收银副屏 | `/corp/shop/*`、`/corp/pos/list`、`/cash/secondary-screen`（audit #111-#113、#121、#95） | 多机构组织超出单机个人商户定位；副屏为硬件店场景，原设计已移除 |
| 在线支付账户（微信/支付宝商户号） | `/account/detail`、mock `baseinfo/accountonline/*`（audit #3） | 需商户云接入；本地资金账户已覆盖记账 |
| 会员积分 | `/setting/integral-set`（audit #168） | 原设计已移除；积分营销与个人商户定位弱相关 (价值待定，如有用户需求可做离线积分) |
| 订阅/版本订阅/服务到期 | `/subscription/*` 7 路由（audit #173-#185） | 已被离线试用+激活码机制替代 |
| 多语言/多币种国际化（7 语言包、自动汇率） | `locale-*.js`、`system/exchange/rate` | 单机中文定位；多币种保留 P3 手动汇率待定项 |
| Sentry 崩溃上报、Google OAuth | `sentry.*.js`、`GoogleLoginOAuth2` | 红线：禁止引入云端依赖/上报 SDK |
| 新手任务积分体系 | mock `beginnertask/*`（points 积分奖励） | 本地引导已实现；积分奖励机制为运营功能 |

---
*本文件仅为分析产出，未改动任何代码。*
