import type {
  AssembleCreateInput,
  AssembleQuery
} from '../../../shared/types/assemble'
import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

export { type AssembleCreateInput, type AssembleQuery } from '../../../shared/types/assemble'

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
