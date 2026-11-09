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

/** [7] 发票状态（S 级功能批次 B） */
export type InvoiceStatus = 'none' | 'invoiced'

/** [9] 发货状态（S 级功能批次 B） */
export type DeliveryStatus = 'none' | 'shipped'

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
  /** 业务员（操作员用户名）；NULL 表示无业务员（旧数据或未传） */
  operator?: string
  // ── S 级功能批次 B：单据业务扩展字段 ──
  /** [3] 外部订单号（电商平台/线上订单号等，人工录入） */
  external_no?: string
  /** [7] 发票状态：'none' 未开票 | 'invoiced' 已开票 */
  invoice_status?: InvoiceStatus
  /** [9] 快递公司 */
  express_com?: string
  /** [9] 快递单号 */
  express_no?: string
  /** [9] 发货状态：'none' 未发货 | 'shipped' 已发货 */
  delivery_status?: DeliveryStatus
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
  serial_numbers?: string[]
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
  /** 红冲关联：本单作为红冲单时指向被红冲的原单；本单被红冲后，红冲单的 reversal_of 指向本单 */
  reversal_of?: number | null
  /** 业务员（操作员用户名）；NULL 表示无业务员（旧数据或未传） */
  operator?: string | null
  // ── S 级功能批次 B ──
  /** [3] 外部订单号 */
  external_no?: string | null
  /** [7] 发票状态：'none' 未开票 | 'invoiced' 已开票 */
  invoice_status?: InvoiceStatus
  /** [9] 快递公司 */
  express_com?: string | null
  /** [9] 快递单号 */
  express_no?: string | null
  /** [9] 发货状态：'none' 未发货 | 'shipped' 已发货 */
  delivery_status?: DeliveryStatus
  /** 审核人用户名；NULL 表示未审核（单据审核功能） */
  reviewed_by?: string | null
  /** 审核时间；NULL 表示未审核 */
  reviewed_at?: string | null
  /** 盘点复盘人（仅 stocktake 单型使用）；NULL 表示未复盘 */
  review_by?: string | null
  /** 盘点复盘时间 */
  review_at?: string | null
  /** 盘点复盘备注 */
  review_remark?: string | null
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
  // ── S 级功能批次 B：筛选 ──
  /** [3] 外部订单号精确匹配 */
  external_no?: string
  /** [7] 发票状态筛选 */
  invoice_status?: InvoiceStatus
  /** [9] 发货状态筛选 */
  delivery_status?: DeliveryStatus
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
  'disassemble',
  'receipt',
  'payment'
])

/** 通用单据详情（doc.service.getDetailWithItems 返回） */
export interface DocDetailWithItems {
  doc: DocRow
  items: DocItemRow[]
}

/** 单据复制时的可覆盖字段（仅日期 / 往来单位 / 备注） */
export interface DocCopyOverrides {
  /** 单据日期 yyyy-MM-dd */
  date?: string
  /** 往来单位 id（客户 / 供应商） */
  partner_id?: number
  /** 备注 */
  remark?: string
}

/**
 * 单据复制结果：被复制的原单 -> 新建草稿单。
 * 新单不产生任何库存变动，仅保留原有明细行（数量 / 单价 / 金额）。
 */
export interface CopiedDocResult {
  /** 新单据 id */
  id: number
  /** 新单据号 */
  no: string
  type: DocType
  date: string
  /** 新单为草稿状态 */
  status: 'draft' | 'done'
  partner_id: number | null
  warehouse_id: number | null
  warehouse_in_id: number | null
  account_id: number | null
  /** 来源单据 id（被复制的原单） */
  source_doc_id: number | null
  total_amount: number
  remark: string | null
  /** 被复制的原单号 */
  copied_from_no: string | null
  /** 新单明细 */
  items: DocItemRow[]
}
