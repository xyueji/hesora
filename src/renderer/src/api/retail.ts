import type { RetailCreateInput, RetailHeldCart, RetailQuery } from '../../../shared/types/retail'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type RetailCreateInput, type RetailQuery, type RetailItemInput } from '../../../shared/types/retail'

export interface RetailDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const retailApi = {
  create: (p: RetailCreateInput) => call<DocRow>('retail:create', p),
  hold: (p: RetailCreateInput) => call<number>('retail:hold', p),
  listHeld: () => call<RetailHeldCart[]>('retail:listHeld'),
  discardHeld: (id: number) => call<void>('retail:discardHeld', id),
  getDetail: (id: number) => call<RetailDetail>('retail:getDetail', id),
  query: (q: RetailQuery) => call<DocPageResult>('retail:query', q)
}
