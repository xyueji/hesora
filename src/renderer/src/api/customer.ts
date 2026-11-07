import { call } from './call'
import type { Customer, CustomerQuery } from '../../../shared/types/customer'
import type { PageResult } from '../../../shared/types/common'

export const customerApi = {
  create: (p: Omit<Customer, 'id'>) => call<number>('customer:create', p),
  update: (id: number, p: Partial<Customer>) => call<void>('customer:update', { id, p }),
  get: (id: number) => call<Customer | null>('customer:get', id),
  query: (q: CustomerQuery) => call<PageResult<Customer>>('customer:query', q),
  disable: (id: number) => call<void>('customer:disable', id),
  enable: (id: number) => call<void>('customer:enable', id)
}
