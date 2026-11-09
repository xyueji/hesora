import { call } from './call'
import type { DocItemRow, DocPageResult, DocRow } from '../../../shared/types/doc'

/** P3：内部领用出库单（doc type='internal_use'，编号 NL 前缀） */
export interface InternalUseItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  /** 领用人（记入明细 remark） */
  receiver?: string
  /** 用途（记入明细 remark） */
  purpose?: string
  serial_numbers?: string[]
}

export interface InternalUseCreateInput {
  warehouse_id: number
  date?: string
  remark?: string
  operator?: string
  items: InternalUseItemInput[]
}

export interface InternalUseDetail {
  doc: DocRow
  items: DocItemRow[]
}

export const internalUseApi = {
  create: (input: InternalUseCreateInput) => call<DocRow>('internalUse:create', input),
  getDetail: (id: number) => call<InternalUseDetail>('internalUse:getDetail', id),
  query: (q: { date_from?: string; date_to?: string; keyword?: string; page: number; pageSize: number }) =>
    call<DocPageResult>('internalUse:query', q)
}
