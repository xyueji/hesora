// 试用期全功能放行：试用期内（fullAccess=true）授予专业版全部特征；
// 到期只读（fullAccess=false）不授予任何特征，防止过期用户仍启动 LAN 主机/使用专业版。
// 本文件不依赖 getStatus()：由调用方（index.ts）传入 fullAccess 布尔，避免 services 层耦合状态机。
// 本文件不 import electron（services 层禁顶层 electron）。
import type { LicensePayload, LicenseFeature } from '../../../shared/license'

/** 试用期内授予的全功能授权载荷：professional 版 + 全部 6 个特征位 + 无设备数上限。 */
export const TRIAL_FULL_PAYLOAD: LicensePayload = {
  customer: '试用用户',
  issuedAt: '',
  edition: 'professional',
  features: [
    'lan_collaboration',
    'cloud_backup',
    'multi_warehouse',
    'rbac',
    'device_handoff',
    'serial_batch'
  ] satisfies LicenseFeature[],
  maxDevices: Number.MAX_SAFE_INTEGER
}

/**
 * 返回当前生效的授权载荷：
 * - fullAccess=true（试用期 phase='trial' 或已激活 phase='activated'）→ 返回 real（已激活时）或试用全功能载荷；
 * - fullAccess=false（过期 phase='expired'）→ 返回 null（standard 空特征，拒绝专业版功能）。
 * 调用方在 index.ts 计算 fullAccess = status.phase === 'trial' || status.phase === 'activated'。
 */
export function effectiveLicensePayload(
  real: LicensePayload | null,
  fullAccess: boolean
): LicensePayload | null {
  if (!fullAccess) return null
  return real ?? TRIAL_FULL_PAYLOAD
}
