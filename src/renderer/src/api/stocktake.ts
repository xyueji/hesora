import type { StocktakeCreateInput, StocktakeQuery } from '../../../shared/types/stocktake'
import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'
import type { StocktakeSheetRow } from '../../../shared/types/stocktake'

export { type StocktakeCreateInput, type StocktakeItemInput, type StocktakeQuery, type StocktakeSheetRow } from '../../../shared/types/stocktake'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

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
