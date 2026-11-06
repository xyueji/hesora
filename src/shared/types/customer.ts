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
  credit_limit?: number | null
  remark?: string
  disabled?: boolean
}

export interface CustomerQuery extends PageQuery {}
