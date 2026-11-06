import type {
  AssembleCreateInput,
  AssembleQuery
} from '../../../shared/types/assemble'
import type { Result } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type AssembleCreateInput, type AssembleQuery } from '../../../shared/types/assemble'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export interface AssembleDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const assembleApi = {
  create: (p: AssembleCreateInput) => call<DocRow>('assemble:create', p),
  disassemble: (p: AssembleCreateInput) => call<DocRow>('assemble:disassemble', p),
  getDetail: (id: number) => call<AssembleDetail>('assemble:getDetail', id),
  getDisassembleDetail: (id: number) => call<AssembleDetail>('assemble:getDisassembleDetail', id),
  query: (q: AssembleQuery) => call<DocPageResult>('assemble:query', q)
}
