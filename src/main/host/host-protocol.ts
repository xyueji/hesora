// v1.3 Task 3: LAN 网关协议层——纯类型与常量（无逻辑，不 import Electron）。

/** LAN 会话上下文：网关分发 handler 时注入，替代全局 currentUser（本地 IPC 路径 session=undefined）。 */
export interface SessionContext {
  deviceId: string
  userId: number
}

/** LAN RPC 请求体（HTTP POST /rpc/{channel} 的 JSON body）。 */
export interface RpcRequest {
  requestId: string
  channel: string
  payload: unknown
}

/** 本机专用前缀：这些通道与 Electron 生命周期/本机外设/登录态绑定，根本不该进 LAN 网关（防御性拦截）。
 * auth: 包含其中——LAN 登录态由 pairing/session 层管理，auth:login/logout 会覆写主机全局
 * currentUser、auth:setup 可重设 admin，绝不允许 LAN 直调。 */
// v1.3 Task 6：常量下沉到 src/shared/channels.ts（preload 不能 import src/main）；此处 re-export 保持既有 import 路径不变。
export { LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES } from '../../shared/channels'


/**
 * 幂等写通道清单（与 grep src/main/ipc/handlers.ts 实际通道对账）。
 * spec §4.4：LAN 客户端对这些通道必须携带 requestId；重放直接返回缓存 Result。
 * 注意：handlers.ts 中不存在 stocktake:save / stocktake:post（实际为 stocktake:create / importSheet / review）。
 */
export const IDEMPOTENT_CHANNELS = new Set([
  'sale:create',
  'sale:createReturn',
  'retail:create',
  'purchase:create',
  'purchase:createReturn',
  'payment:create',
  'payment:createReceipt',
  'payment:createPayment',
  'transfer:create',
  'stocktake:create',
  'stocktake:importSheet',
  'stocktake:review',
  'assemble:create',
  'assemble:disassemble',
  'opening:save',
  'doc:reverse',
  'doc:review'
])

/**
 * 确定性失败码：这些 Result 可安全缓存并在重放时原样返回（同输入必得同输出）。
 * 与 grep src/main + src/main/services 的 BizError code 实际对账
 * （STATE_INVALID / E_REQUEST_ID_CONFLICT / E_LOCAL_ONLY 在代码库中尚无抛出点，预留）。
 */
export const DETERMINISTIC_CODES = new Set([
  'NOT_ENOUGH',
  'NO_PERMISSION',
  'FORBIDDEN',
  'VALIDATION',
  'DUP_NAME',
  'DUP_CODE',
  'NOT_FOUND',
  'IN_USE',
  'PREPAID_INSUFFICIENT',
  'RETURN_LIMIT',
  'OPENING_DONE',
  'DOC_DONE',
  'CANCELLED',
  'LICENSE_INVALID',
  'E_HOST_ONLY',
  'E_LOCAL_ONLY',
  'E_REQUEST_ID_CONFLICT',
  'E_BACKUP_NEWER',
  'E_BACKUP_INVALID'
])
