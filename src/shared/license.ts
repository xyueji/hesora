import { sign } from 'node:crypto'

export interface LicensePayload {
  customer: string
  issuedAt: string
  expiresAt?: string | null
  machine?: string | null
}

export const LICENSE_CODE_PREFIX = 'ZHJS1.'
export const TRIAL_DAYS = 7

/** 试用期总长（含一次 7 天延期后）：15 天 = 7 天试用 + 7 天延期 + 1 天缓冲边界。 */
export const TRIAL_TOTAL_DAYS = 15

/**
 * 试用状态阶段：
 * - trial     第 1-7 天全功能试用
 * - extended  已使用一次 7 天延期（第 8-14 天）
 * - expired   超过可用天数 → 只读模式（禁止业务单据写操作）
 * - activated 已激活正式授权
 */
export type TrialPhase = 'trial' | 'extended' | 'expired' | 'activated'

/**
 * 只读模式（expired）下拦截的业务单据写通道清单。
 * 注意：主档（商品/客户/供应商/仓库/资金账户）、设置、期初建账允许继续编辑（便于迁移准备）；
 * 查看、导出（csv:export）、备份恢复（backup:*）、同步（sync:*）、激活（license:*）、
 * 试用状态（trial:*）一律放行。
 */
export const TRIAL_EXPIRED_BLOCKED_CHANNELS: readonly string[] = [
  // 销售 / 采购
  'sale:create', 'sale:createReturn',
  'purchase:create', 'purchase:createReturn',
  // 零售
  'retail:create', 'retail:hold', 'retail:discardHeld',
  // 库存：调拨 / 盘点 / 组装拆卸
  'transfer:create',
  'stocktake:create', 'stocktake:importSheet', 'stocktake:review',
  'assemble:create', 'assemble:disassemble',
  // 资金 / 收付款核销
  'payment:create', 'payment:createPayment', 'payment:createReceipt', 'payment:openDocuments',
  'ledger:transfer',
  // 单据操作：复制 / 红冲 / 审核
  'doc:copy', 'doc:reverse', 'doc:review',
  // 工作流（报价/订单链）
  'workflow:save', 'workflow:approve', 'workflow:convert', 'workflow:cancel',
  // 序列号台账写
  'serial:registerIn', 'serial:consumeOut',
  // 附件写（只读模式附件仅可查看）
  'attachment:save', 'attachment:remove'
]

/**
 * 主进程 guard 判定：当前状态是否应拒绝该通道。
 * phase 非 expired 一律放行；expired 时按拦截清单 + 明确白名单判定。
 */
export function isTrialExpiredWrite(channel: string, phase: TrialPhase, daysLeft?: number): boolean {
  if (phase === 'activated' || phase === 'trial' || phase === 'extended') return false
  void daysLeft
  // 白名单：激活 / 试用延期 / 备份恢复 / 同步 / 导出 / 引导设置不受只读限制
  if (channel.startsWith('license:') || channel.startsWith('trial:') || channel.startsWith('backup:') ||
      channel.startsWith('sync:') || channel.startsWith('csv:') || channel.startsWith('auth:') ||
      channel.startsWith('update:')) return false
  return TRIAL_EXPIRED_BLOCKED_CHANNELS.includes(channel)
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

/**
 * Generate a license code. Used ONLY by the activation server CLI and tests —
 * the app itself only verifies.
 */
export function generateLicenseCode(payload: LicensePayload, privateKeyPem: string): string {
  const canonical = JSON.stringify(payload)
  const sig = sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem)
  return `${LICENSE_CODE_PREFIX}${b64url(canonical)}.${b64url(sig)}`
}
