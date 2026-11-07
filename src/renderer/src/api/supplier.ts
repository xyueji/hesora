import { call } from './call'
import type { Supplier, SupplierQuery } from '../../../shared/types/supplier'
import type { PageResult } from '../../../shared/types/common'

export const supplierApi = {
  create: (p: Omit<Supplier, 'id'>) => call<number>('supplier:create', p),
  update: (id: number, p: Partial<Supplier>) => call<void>('supplier:update', { id, p }),
  get: (id: number) => call<Supplier | null>('supplier:get', id),
  query: (q: SupplierQuery) => call<PageResult<Supplier>>('supplier:query', q),
  disable: (id: number) => call<void>('supplier:disable', id),
  enable: (id: number) => call<void>('supplier:enable', id)
}
