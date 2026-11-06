import type { TransferCreateInput, TransferQuery } from '../../../shared/types/transfer'
import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type TransferCreateInput, type TransferQuery, type TransferItemInput } from '../../../shared/types/transfer'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export interface TransferDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const transferApi = {
  create: (p: TransferCreateInput) => call<DocRow>('transfer:create', p),
  getDetail: (id: number) => call<TransferDetail>('transfer:getDetail', id),
  query: (q: TransferQuery) => call<DocPageResult>('transfer:query', q)
}
