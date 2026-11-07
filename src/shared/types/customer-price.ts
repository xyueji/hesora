// 客户×商品专属价 共享类型（主进程与渲染进程共用）

export interface CustomerPriceRow {
  id: number
  customer_id: number
  product_id: number
  price: number
  updated_at: string
}

export interface PriceChangeLogRow {
  id: number
  scope: 'customer_product' | 'price_level'
  customer_id: number | null
  product_id: number
  old_price: number | null
  new_price: number
  operator: string | null
  created_at: string
}

export interface ChangeLogQuery {
  customer_id?: number
  product_id?: number
  scope?: 'customer_product' | 'price_level'
}
