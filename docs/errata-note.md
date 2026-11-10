# v1.4 勘误（errata）

本文件记录 v1.4 授权门控新增错误码与门控范围。两项错误码已并入
`docs/user-manual-v1.3-lan.md` §3.2 常见错误表；此处保留作定价/授权口径的单一出处。

## 新增错误码（v1.4 license gate）

| 错误码 | 含义 | 处理 |
|---|---|---|
| `E_FEATURE_PRO` | 此功能为专业版专属，当前授权（基础版 / 试用到期只读 / 旧授权码）无该功能；7 天试用期内全功能，不触发本错误 | 升级为专业版授权后使用（多仓、序列号/批次效期、员工账号 RBAC）；试用期内无需升级 |
| `E_DEVICE_LIMIT` | LAN 协作接入设备数已达授权上限（`maxDevices`，基础版缺省 1 台） | 吊销不用的设备后再配对，或升级授权提高上限 |

## v1.4 门控范围（定价口径）

- 专业版专属（standard 下抛 `E_FEATURE_PRO`）：多仓（第二仓起 + 多仓调拨）、序列号/批次效期（`serial:registerIn/consumeOut`、`product:setShelfLife/saveBatch`、单据带 `serial_numbers`）、员工账号 RBAC（user:/role: 管理通道）。
- 基础版可用（不门控）：本地开单、云盘备份、云盘接力上传（`sync:*` / device_handoff 特征位不拦截）、LAN 配对首台设备。
- 多设备：接入设备数按 `maxDevices` 上限（`E_DEVICE_LIMIT`）。

## 手册错误码清单

已并入 `docs/user-manual-v1.3-lan.md` §3.2 常见错误与处理表（v1.4 收尾时完成）。
