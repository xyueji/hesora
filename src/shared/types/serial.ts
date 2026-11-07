/**
 * 序列号（SN）台账相关类型。
 *
 * 语义约定：
 *  - 只有 `product.tracking_type = 'serial'` 的商品才允许登记序列号；
 *  - 同一商品下序列号唯一，入库登记（registerIn）后只能被核销（consumeOut）；
 *  - serial_flow 记录每一次出入库事件，形成"序列号流向"。
 */

export type SerialStatus = 'in_stock' | 'out'

export type SerialDirection = 'in' | 'out'

/** 入库登记（序列号落账） */
export interface RegisterSerialInput {
  product_id: number
  warehouse_id: number
  batch_no?: string
  sn: string
  /** 默认 1；序列号商品一般一件一码 */
  qty?: number
  /** 来源单据类型，如 'purchase' */
  source?: string
  /** 来源单据 id（doc.id） */
  source_id?: number
  /** 来源单据明细 id（doc_item.id），便于追溯到具体行 */
  doc_item_id?: number
  /** 备注 */
  remark?: string
}

/** 出库核销（序列号销账） */
export interface ConsumeSerialInput {
  product_id: number
  sn: string
  warehouse_id?: number
  batch_no?: string
  original_purchase_id?: number
  /** 默认 1 */
  qty?: number
  /** 来源单据类型，如 'sale' */
  source?: string
  /** 来源单据 id（doc.id） */
  source_id?: number
  /** 来源单据明细 id（doc_item.id），便于追溯到具体行 */
  doc_item_id?: number
}

export interface SerialStockQuery {
  /** 序列号 / 商品编码 / 商品名称 模糊匹配 */
  keyword?: string
  product_id?: number
  warehouse_id?: number
  status?: SerialStatus
  page: number
  pageSize: number
}

export interface SerialStockRow {
  id: number
  sn: string
  product_id: number
  product_code: string
  product_name: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  status: SerialStatus
  in_qty: number
  out_qty: number
  in_date: string
  out_date: string | null
  in_source: string | null
  in_source_id: number | null
  in_source_no: string | null
  out_source: string | null
  out_source_id: number | null
  out_source_no: string | null
  remark: string | null
}

export interface SerialStockPageResult {
  total: number
  items: SerialStockRow[]
}

export interface SerialFlowQuery {
  /** 序列号模糊匹配 */
  sn?: string
  product_id?: number
  page: number
  pageSize: number
}

export interface SerialFlowRow {
  id: number
  sn: string
  product_id: number
  product_code: string
  product_name: string
  doc_id: number | null
  doc_no: string | null
  doc_item_id: number | null
  direction: SerialDirection
  qty: number
  created_at: string
}

export interface SerialFlowPageResult {
  total: number
  items: SerialFlowRow[]
}

/**
 * 序列号预校验结果（保存单据前调用，direction 决定语义）：
 *  - direction='in'（入库登记前）：
 *      duplicates = 该商品台账中已存在的序列号（不可重复登记，否则 registerIn 会报错）；
 *      unknown   = 空数组（新序列号对入库是合法的）；
 *  - direction='out'（出库核销前）：
 *      duplicates = 本次列表中重复录入的序列号（同一序列号被录了两行）；
 *      unknown   = 台账中不存在或已出库的序列号（不可核销）。
 */
export interface ValidateSnResult {
  ok: boolean
  duplicates: string[]
  unknown: string[]
}

/** 序列号校验方向：入库登记 / 出库核销 */
export type SerialValidateDirection = 'in' | 'out'
