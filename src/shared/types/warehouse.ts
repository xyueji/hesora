import type { PageQuery } from './common'

export interface Warehouse {
  id?: number
  code?: string
  name: string
  address?: string
  remark?: string
  is_default: boolean
  disabled?: boolean
}

export interface WarehouseQuery extends PageQuery {}
