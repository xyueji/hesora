import type { PurchaseItemInput } from './purchase'

export const WORKFLOW_KINDS = ['quote', 'sale_order', 'purchase_order', 'sale', 'purchase'] as const
export type WorkflowKind = typeof WORKFLOW_KINDS[number]
export const WORKFLOW_LABELS: Record<WorkflowKind, string> = {
  quote: '报价单', sale_order: '销售订单', purchase_order: '采购订单', sale: '销售单', purchase: '进货单'
}
export const WORKFLOW_CONVERSIONS: Partial<Record<WorkflowKind, readonly WorkflowKind[]>> = {
  quote: ['sale_order', 'sale'], sale_order: ['sale'], purchase_order: ['purchase']
}

export interface WorkflowInput {
  id?: number
  kind: WorkflowKind
  warehouse_id: number
  partner_id?: number
  date: string
  remark?: string
  items: PurchaseItemInput[]
}

export interface WorkflowRow extends WorkflowInput {
  id: number
  status: 'draft' | 'approved' | 'cancelled'
  source_id: number | null
  posted_doc_id: number | null
  posted_doc_no: string | null
  converted_id: number | null
  approved_by: number | null
}
