import type { Database } from 'better-sqlite3'

/**
 * 让利闭环：全局开单抹零设置（app_setting 键 'sale.rounding'，JSON {enabled, mode}）。
 * mode 语义：'fen' = 不抹（默认）；'jiao' = 抹到 0.1 元（角）；'yuan' = 抹到整数（元）。
 * 抹零差额 = 原应付 − 抹零后应付，作为整单优惠（preferential_amount）留存，
 * 只影响应收/实收金额，不入库存成本（明细金额与成本核算不变）。
 */
export interface RoundingSetting {
  enabled: boolean
  mode: 'jiao' | 'yuan' | 'fen'
}

export const DEFAULT_ROUNDING: RoundingSetting = { enabled: false, mode: 'fen' }

export function readRoundingSetting(db: Database): RoundingSetting {
  const raw = db.prepare('SELECT value FROM app_setting WHERE key = ?').get('sale.rounding') as
    | { value: string }
    | undefined
  if (!raw?.value) return DEFAULT_ROUNDING
  try {
    const parsed = JSON.parse(raw.value) as Partial<RoundingSetting>
    if (typeof parsed.enabled !== 'boolean' || !parsed.mode) return DEFAULT_ROUNDING
    if (parsed.mode !== 'jiao' && parsed.mode !== 'yuan' && parsed.mode !== 'fen') return DEFAULT_ROUNDING
    return { enabled: parsed.enabled, mode: parsed.mode }
  } catch {
    return DEFAULT_ROUNDING
  }
}

/**
 * 计算抹零后的应付金额与抹零差额（优惠）。
 * 返回 { total, preferential }；未启用或 mode='fen' 时差额为 0。
 */
export function applyRounding(setting: RoundingSetting, gross: number): { total: number; preferential: number } {
  if (!setting.enabled || setting.mode === 'fen') {
    return { total: Number(gross.toFixed(2)), preferential: 0 }
  }
  const rounded = setting.mode === 'yuan' ? Math.floor(gross) : Math.floor(gross * 10) / 10
  const preferential = Number((gross - rounded).toFixed(2))
  return { total: Number(rounded.toFixed(2)), preferential }
}
