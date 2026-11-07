import type { StocktakeCreateInput, StocktakeQuery } from '../../../shared/types/stocktake'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'
import type { StocktakeSheetRow } from '../../../shared/types/stocktake'

export { type StocktakeCreateInput, type StocktakeItemInput, type StocktakeQuery, type StocktakeSheetRow } from '../../../shared/types/stocktake'

export interface StocktakeDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const stocktakeApi = {
  getSheet: (warehouse_id: number, keyword?: string) =>
    call<StocktakeSheetRow[]>('stocktake:getSheet', { warehouse_id, keyword }),
  create: (p: StocktakeCreateInput) => call<DocRow>('stocktake:create', p),
  getDetail: (id: number) => call<StocktakeDetail>('stocktake:getDetail', id),
  query: (q: StocktakeQuery) => call<DocPageResult>('stocktake:query', q)
}
