import type { SaleItemInput, SaleCreateInput, SaleReturnInput, SaleQuery } from '../../../shared/types/sale'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type SaleItemInput, type SaleCreateInput, type SaleQuery }

export interface SaleDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const saleApi = {
  create: (p: SaleCreateInput) => call<DocRow>('sale:create', p),
  createReturn: (p: SaleReturnInput) => call<DocRow>('sale:createReturn', p),
  getDetail: (id: number) => call<SaleDetail>('sale:getDetail', id),
  query: (q: SaleQuery) => call<DocPageResult>('sale:query', q)
}
