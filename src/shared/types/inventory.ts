export interface StockQuery {
  keyword?: string
  warehouse_id?: number
  page: number
  pageSize: number
}

export interface StockItem {
  product_id: number
  product_code: string
  product_name: string
  spec: string
  unit: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  qty: number
  moving_cost: number
  amount: number
}

export interface StockPageResult {
  total: number
  items: StockItem[]
}

export interface InventoryChange {
  product_id: number
  warehouse_id: number
  batch_no?: string // '' for non-batch
  change_qty: number // + in, - out
  unit_cost?: number // required for IN (change_qty > 0); ignored for OUT (uses moving_cost)
  source?: string // e.g. 'purchase', 'sale', 'opening'
  source_id?: number
}

export interface InventoryRow {
  id: number
  product_id: number
  warehouse_id: number
  batch_no: string
  qty: number
  moving_cost: number
}

export interface CostLogRow {
  id: number
  product_id: number
  warehouse_id: number
  batch_no: string
  change_qty: number
  unit_cost: number
  after_qty: number
  after_cost: number
  source: string | null
  source_id: number | null
}
