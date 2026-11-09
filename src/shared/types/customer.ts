import type { PageQuery } from './common'

export interface Customer {
  id?: number
  code: string
  name: string
  contact?: string
  phone?: string
  address?: string
  price_level?: string
  opening_receivable: number
  /** P1 功能 #2：预存款余额（收款单 charge_type=prepaid 计入；销售/零售可抵扣） */
  prepaid?: number
  credit_limit?: number | null
  /** [4] 电子邮箱（服务层简单格式校验） */
  email?: string
  /** [8] 分类：自由文本，常用值 普通/批发/VIP（前端 datalist 建议），'' 表示未分类 */
  category?: string
  remark?: string
  disabled?: boolean
}

export interface CustomerQuery extends PageQuery {
  /** [8] 分类筛选（精确匹配） */
  category?: string
}
