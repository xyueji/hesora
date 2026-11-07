import { call } from './call'
import type { FundAccount, FundAccountQuery } from '../../../shared/types/fund'
import type { PageResult } from '../../../shared/types/common'

export const fundApi = {
  create: (p: Omit<FundAccount, 'id'>) => call<number>('fund:create', p),
  update: (id: number, p: Partial<FundAccount>) => call<void>('fund:update', { id, p }),
  get: (id: number) => call<FundAccount | null>('fund:get', id),
  query: (q: FundAccountQuery) => call<PageResult<FundAccount>>('fund:query', q),
  disable: (id: number) => call<void>('fund:disable', id),
  enable: (id: number) => call<void>('fund:enable', id)
}
