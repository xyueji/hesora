import type { RetailCreateInput, RetailQuery } from '../../../shared/types/retail'
import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type RetailCreateInput, type RetailQuery, type RetailItemInput } from '../../../shared/types/retail'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export interface RetailDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const retailApi = {
  create: (p: RetailCreateInput) => call<DocRow>('retail:create', p),
  getDetail: (id: number) => call<RetailDetail>('retail:getDetail', id),
  query: (q: RetailQuery) => call<DocPageResult>('retail:query', q)
}
