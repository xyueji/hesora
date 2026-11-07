import type { TransferCreateInput, TransferQuery } from '../../../shared/types/transfer'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type TransferCreateInput, type TransferQuery, type TransferItemInput } from '../../../shared/types/transfer'

export interface TransferDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const transferApi = {
  create: (p: TransferCreateInput) => call<DocRow>('transfer:create', p),
  getDetail: (id: number) => call<TransferDetail>('transfer:getDetail', id),
  query: (q: TransferQuery) => call<DocPageResult>('transfer:query', q)
}
