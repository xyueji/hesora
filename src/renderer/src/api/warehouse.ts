import { call } from './call'
import type { Warehouse, WarehouseQuery } from '../../../shared/types/warehouse'
import type { PageResult } from '../../../shared/types/common'

export const warehouseApi = {
  create: (p: Omit<Warehouse, 'id'>) => call<number>('warehouse:create', p),
  update: (id: number, p: Partial<Warehouse>) => call<void>('warehouse:update', { id, p }),
  get: (id: number) => call<Warehouse | null>('warehouse:get', id),
  query: (q: WarehouseQuery) => call<PageResult<Warehouse>>('warehouse:query', q),
  setDefault: (id: number) => call<void>('warehouse:set-default', id),
  disable: (id: number) => call<void>('warehouse:disable', id),
  enable: (id: number) => call<void>('warehouse:enable', id)
}
