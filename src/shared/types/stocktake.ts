export interface StocktakeSheetRow {
  product_id: number
  product_code: string
  product_name: string
  spec: string
  unit: string
  batch_no: string
  book_qty: number
  moving_cost: number
}

export interface StocktakeItemInput {
  product_id: number
  batch_no?: string
  /** 实盘数量（按 unit 计量的数量） */
  actual_qty: number
  unit?: string
  /** unit 相对基本单位的换算率，实际入库数量 = actual_qty * rate */
  rate?: number
}

export interface StocktakeCreateInput {
  warehouse_id: number
  date?: string
  remark?: string
  items: StocktakeItemInput[]
}

export interface StocktakeQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  page: number
  pageSize: number
}

export interface StocktakeImportRow {
  product_id: number
  product_code: string
  product_name: string
  unit: string
  batch_no: string
  book_qty: number
  actual_qty: number
  diff: number
}
