import type { SaleItemInput, SaleCreateInput, SaleQuery } from '../../../shared/types/sale'
import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type SaleItemInput, type SaleCreateInput, type SaleQuery }

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export interface SaleDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const saleApi = {
  create: (p: SaleCreateInput) => call<DocRow>('sale:create', p),
  createReturn: (p: SaleCreateInput) => call<DocRow>('sale:createReturn', p),
  getDetail: (id: number) => call<SaleDetail>('sale:getDetail', id),
  query: (q: SaleQuery) => call<DocPageResult>('sale:query', q)
}
