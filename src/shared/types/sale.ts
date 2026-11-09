import type { TrackingItemInput } from './inventory'
import type { DeliveryStatus, InvoiceStatus } from './doc'

export interface SaleItemInput extends TrackingItemInput {
  product_id: number
  batch_no?: string
  unit?: string
  rate?: number
  qty: number
  /** 单价：可省略，服务层未传时按 客户专属价>等级价>零售价 兜底解析 */
  price?: number
  /** P3：提成率（%，下单时从商品带出、可改） */
  commission_rate?: number
}

export interface SaleCreateInput {
  customer_id?: number
  warehouse_id: number
  date?: string
  remark?: string
  /** 业务员（操作员用户名） */
  operator?: string
  /** P1 功能 #2 预存款抵扣：从 customer.prepaid 扣减的金额（需 ≤ 预存款余额；散客不可用） */
  prepaid_amount?: number
  /** 让利闭环：整单优惠（立减）金额，≥0 且 < 商品合计；total_amount = 商品合计 − preferential_amount */
  preferential_amount?: number
  // ── S 级功能批次 B ──
  /** [3] 外部订单号 */
  external_no?: string
  /** [7] 发票状态 */
  invoice_status?: InvoiceStatus
  /** [9] 快递公司 */
  express_com?: string
  /** [9] 快递单号 */
  express_no?: string
  /** [9] 发货状态 */
  delivery_status?: DeliveryStatus
  items: SaleItemInput[]
}

export interface SaleReturnInput extends SaleCreateInput {
  account_id?: number
  source_doc_id?: number
}

export interface SaleQuery {
  date_from?: string
  date_to?: string
  keyword?: string
  partner_id?: number
  /** 不传返回销售单+退货单；'sale' 仅销售单；'sale_return' 仅退货单 */
  type?: 'sale' | 'sale_return'
  /** [7] 发票状态筛选 */
  invoice_status?: InvoiceStatus
  /** [9] 发货状态筛选 */
  delivery_status?: DeliveryStatus
  page: number
  pageSize: number
}
