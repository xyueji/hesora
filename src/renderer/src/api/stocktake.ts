import type {
  StocktakeCreateInput,
  StocktakeImportRow,
  StocktakeQuery
} from '../../../shared/types/stocktake'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'
import type { StocktakeSheetRow } from '../../../shared/types/stocktake'

export { type StocktakeCreateInput, type StocktakeImportRow, type StocktakeItemInput, type StocktakeQuery, type StocktakeSheetRow } from '../../../shared/types/stocktake'

export interface StocktakeDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const stocktakeApi = {
  getSheet: (warehouse_id: number, keyword?: string) =>
    call<StocktakeSheetRow[]>('stocktake:getSheet', { warehouse_id, keyword }),
  create: (p: StocktakeCreateInput) => call<DocRow>('stocktake:create', p),
  getDetail: (id: number) => call<StocktakeDetail>('stocktake:getDetail', id),
  query: (q: StocktakeQuery) => call<DocPageResult>('stocktake:query', q),
  /** CSV 导入盘点草稿（不自动过账，返回行明细与错误行供确认） */
  importSheet: (csv_text: string, warehouse_id: number, date?: string) =>
    call<{ date: string; rows: StocktakeImportRow[]; errors: Array<{ row: number; message: string }> }>(
      'stocktake:importSheet',
      { csv_text, warehouse_id, date }
    ),
  /** P2：盘点复盘（幂等，取最新） */
  review: (docId: number, reviewBy: string, reviewRemark?: string) =>
    call<DocRow>('stocktake:review', { docId, review_by: reviewBy, review_remark: reviewRemark })
}
