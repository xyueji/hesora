import { call } from './call'

export interface FormulaItemRow {
  id: number
  formula_id: number
  product_id: number
  qty: number
}

export interface FormulaRow {
  id: number
  name: string
  output_product_id: number
  output_qty: number
  remark: string | null
  disabled: 0 | 1
  created_at: string
  updated_at: string | null
  items: FormulaItemRow[]
}

export interface FormulaItemInput {
  product_id: number
  qty: number
}

export interface FormulaInput {
  name: string
  output_product_id: number
  output_qty?: number
  remark?: string
  items: FormulaItemInput[]
}

export const formulaApi = {
  list: (query?: { include_disabled?: boolean }) => call<FormulaRow[]>('formula:list', query ?? {}),
  get: (id: number) => call<FormulaRow | null>('formula:get', id),
  create: (input: FormulaInput) => call<number>('formula:create', input),
  update: (id: number, input: Partial<FormulaInput>) => call<void>('formula:update', { id, ...input }),
  remove: (id: number) => call<void>('formula:remove', id),
  disable: (id: number) => call<void>('formula:disable', id),
  enable: (id: number) => call<void>('formula:enable', id)
}
