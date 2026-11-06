export type DocType =
  | 'purchase'
  | 'sale'
  | 'retail'
  | 'purchase_return'
  | 'sale_return'
  | 'transfer'
  | 'stocktake'
  | 'assemble'
  | 'disassemble'
  | 'receipt'
  | 'payment'
  | 'other_out'
  | 'other_in'

export interface DocItemInput {
  product_id: number
  warehouse_id?: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  price?: number
}

export interface DocCreateInput {
  type: DocType
  date?: string
  partner_id?: number
  warehouse_id?: number
  warehouse_in_id?: number
  account_id?: number
  remark?: string
  items: DocItemInput[]
}

export interface DocItemRow {
  id: number
  doc_id: number
  product_id: number
  warehouse_id: number | null
  batch_no: string
  unit: string
  rate: number
  qty: number
  price: number
  amount: number
}

export interface DocRow {
  id: number
  no: string
  type: DocType
  date: string
  partner_id: number | null
  warehouse_id: number | null
  warehouse_in_id: number | null
  account_id: number | null
  total_amount: number
  remark: string | null
  status: 'done'
  created_at: string
}

export interface DocQuery {
  type?: DocType
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}

export interface DocPageResult {
  total: number
  items: DocRow[]
}

export const DOC_NO_PREFIX: Record<DocType, string> = {
  purchase: 'CG',
  sale: 'XS',
  retail: 'LS',
  purchase_return: 'CT',
  sale_return: 'XT',
  transfer: 'DB',
  stocktake: 'PD',
  assemble: 'ZZ',
  disassemble: 'CZ',
  receipt: 'SK',
  payment: 'FK',
  other_out: 'QT',
  other_in: 'QR'
}
