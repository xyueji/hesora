// v1.4 授权门控 helper：定价规则与授权规则一致的唯一判定入口。
// 定价：基础版 ¥199（本地开单+云盘备份+云盘接力上传）；
//       专业版 ¥399（+LAN 协同、多仓、序列号/批次效期、员工账号 RBAC、多设备）。
// 本文件不 import electron（services 层禁顶层 electron）。
import { resolveLicenseFeatures, hasFeature, type LicensePayload, type LicenseFeature } from '../../shared/license'
import { BizError } from '../../shared/result'

/** 统一"此功能为专业版专属"错误码（已登记用户手册错误码清单）。 */
export const E_FEATURE_PRO = 'E_FEATURE_PRO'
/** 设备数超授权上限（maxDevices）错误码。 */
export const E_DEVICE_LIMIT = 'E_DEVICE_LIMIT'

const PRO_MSG = '此功能为专业版专属，请升级授权'

/** 断言当前授权为 professional 版，否则抛 E_FEATURE_PRO。 */
export function assertProEdition(payload: LicensePayload | null | undefined): void {
  if (resolveLicenseFeatures(payload).edition !== 'professional') {
    throw new BizError(E_FEATURE_PRO, PRO_MSG)
  }
}

/** 断言授权含指定特征位（standard / 未含均抛 E_FEATURE_PRO）。 */
export function assertFeature(payload: LicensePayload | null | undefined, feature: LicenseFeature): void {
  if (!hasFeature(payload, feature)) {
    throw new BizError(E_FEATURE_PRO, PRO_MSG)
  }
}

/**
 * 断言设备数未超 maxDevices（standard 缺省 1）。
 * currentCount：host_devices 中未 revoked 的设备数（调用方统计）。
 */
export function assertMaxDevices(payload: LicensePayload | null | undefined, currentCount: number): void {
  const max = resolveLicenseFeatures(payload).maxDevices
  if (currentCount >= max) {
    throw new BizError(E_DEVICE_LIMIT, `已达授权设备数上限（${max} 台），如需接入更多设备请升级授权`)
  }
}
