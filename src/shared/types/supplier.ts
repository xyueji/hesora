import type { PageQuery } from './common'

export interface Supplier {
  id?: number
  code: string
  name: string
  contact?: string
  phone?: string
  address?: string
  opening_payable: number
  remark?: string
  disabled?: boolean
}

export interface SupplierQuery extends PageQuery {}
