import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'
import type { PurchaseCreateInput, PurchaseQuery } from '../../../shared/types/purchase'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export interface PurchaseDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const purchaseApi = {
  create: (p: PurchaseCreateInput) => call<DocRow>('purchase:create', p),
  getDetail: (id: number) => call<PurchaseDetail>('purchase:getDetail', id),
  query: (q: PurchaseQuery) => call<DocPageResult>('purchase:query', q)
}
