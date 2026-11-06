import type { PageQuery } from './common'

export type FundAccountType = 'cash' | 'bank' | 'wechat' | 'alipay' | 'other'

export interface FundAccount {
  id?: number
  code?: string
  name: string
  type: FundAccountType
  opening_balance?: number
  remark?: string
  disabled?: boolean
}

export interface FundAccountQuery extends PageQuery {}

export const FUND_ACCOUNT_TYPES: { value: FundAccountType; label: string }[] = [
  { value: 'cash', label: '现金' },
  { value: 'bank', label: '银行' },
  { value: 'wechat', label: '微信' },
  { value: 'alipay', label: '支付宝' },
  { value: 'other', label: '其他' }
]
