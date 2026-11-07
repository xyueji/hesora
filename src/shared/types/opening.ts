export interface OpeningInventoryLine {
  product_id: number
  warehouse_id: number
  batch_no?: string
  qty: number
  unit_cost: number
}
export interface OpeningCustomerLine { customer_id: number; receivable: number }
export interface OpeningSupplierLine { supplier_id: number; payable: number }
export interface OpeningPayload {
  inventory: OpeningInventoryLine[]
  customers?: OpeningCustomerLine[]
  suppliers?: OpeningSupplierLine[]
}
export interface OpeningStatus { done: boolean }

export interface OpeningStockPreview {
  lines: Array<Omit<OpeningInventoryLine, 'warehouse_id'> & { row: number; product_code: string; product_name: string }>
  errors: Array<{ row: number; message: string }>
}
