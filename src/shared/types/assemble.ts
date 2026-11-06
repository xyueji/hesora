import type { DocItemRow, DocRow } from './doc'

export interface BomItemInput {
  product_id: number
  qty: number
}

export interface AssembleCreateInput {
  warehouse_id: number
  date?: string
  remark?: string
  combo_id: number
  qty: number
}

export interface DisassembleCreateInput {
  warehouse_id: number
  date?: string
  remark?: string
  combo_id: number
  qty: number
}

export interface AssembleQuery {
  type?: 'assemble' | 'disassemble'
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}

export interface AssembleDetail {
  doc: DocRow
  items: DocItemRow[]
}
