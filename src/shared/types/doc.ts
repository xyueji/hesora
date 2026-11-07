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
  source_doc_id?: number
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
  source_doc_id?: number | null
  total_amount: number
  remark: string | null
  status: 'done'
  created_at: string
  /** 查询时 JOIN 解析出的往来单位名称（客户或供应商），partner_id 为空时为 null */
  partner_name?: string | null
}

export interface DocQuery {
  type?: DocType
  /** 多类型过滤（与 type 二选一，types 优先） */
  types?: DocType[]
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  partner_keyword?: string
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

/** 单据类型中文名（单据查询中心等通用界面使用） */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  purchase: '采购单',
  sale: '销售单',
  retail: '零售单',
  purchase_return: '采购退货单',
  sale_return: '销售退货单',
  transfer: '调拨单',
  stocktake: '盘点单',
  assemble: '组装单',
  disassemble: '拆卸单',
  receipt: '收款单',
  payment: '付款单',
  other_out: '其他支出',
  other_in: '其他收入'
}

/** 支持 A4 打印的单据类型（与 print.service 的 A4_TITLES 一致） */
export const DOC_A4_PRINTABLE: ReadonlySet<DocType> = new Set<DocType>([
  'purchase',
  'sale',
  'purchase_return',
  'sale_return',
  'transfer',
  'stocktake',
  'assemble',
  'disassemble'
])

/** 通用单据详情（doc.service.getDetailWithItems 返回） */
export interface DocDetailWithItems {
  doc: DocRow
  items: DocItemRow[]
}
