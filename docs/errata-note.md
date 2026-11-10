# v1.4 勘误待补（errata）

本文件为 v1.4 授权门控新增错误码的临时记录，待并入正式用户手册。

## 新增错误码（v1.4 license gate）

| 错误码 | 含义 | 处理 |
|---|---|---|
| `E_FEATURE_PRO` | 此功能为专业版专属，当前授权（基础版/试用/旧授权码）无该功能 | 升级为专业版授权后使用（多仓、序列号/批次效期、员工账号 RBAC） |
| `E_DEVICE_LIMIT` | LAN 协作接入设备数已达授权上限（`maxDevices`，基础版缺省 1 台） | 吊销不用的设备后再配对，或升级授权提高上限 |

## v1.4 门控范围（定价口径）

- 专业版专属（standard 下抛 `E_FEATURE_PRO`）：多仓（第二仓起 + 多仓调拨）、序列号/批次效期（`serial:registerIn/consumeOut`、`product:setShelfLife/saveBatch`、单据带 `serial_numbers`）、员工账号 RBAC（user:/role: 管理通道）。
- 基础版可用（不门控）：本地开单、云盘备份、云盘接力上传（`sync:*` / device_handoff 特征位不拦截）、LAN 配对首台设备。
- 多设备：接入设备数按 `maxDevices` 上限（`E_DEVICE_LIMIT`）。

## 手册错误码清单待并入

`docs/user-manual-v1.3-lan.md` §3.2 常见错误表由另一代理维护中，为避免冲突本次未直接修改；
上表两行待该文件下次编辑时并入。
