import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'
import type { PurchaseCreateInput, PurchaseReturnInput, PurchaseQuery } from '../../../shared/types/purchase'

export interface PurchaseDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const purchaseApi = {
  create: (p: PurchaseCreateInput) => call<DocRow>('purchase:create', p),
  createReturn: (p: PurchaseReturnInput) => call<DocRow>('purchase:createReturn', p),
  getDetail: (id: number) => call<PurchaseDetail>('purchase:getDetail', id),
  query: (q: PurchaseQuery) => call<DocPageResult>('purchase:query', q)
}
