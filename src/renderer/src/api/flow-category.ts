import { call } from './call'

/** P3：进出类别字典（flow_category 表，migration 061） */
export interface FlowCategoryRow {
  id: number
  name: string
  kind: 'in' | 'out'
  disabled: boolean
  created_at: string
}

export const flowCategoryApi = {
  list: (query?: { kind?: 'in' | 'out'; include_disabled?: boolean }) =>
    call<FlowCategoryRow[]>('flowCategory:list', query ?? {}),
  create: (input: { name: string; kind: 'in' | 'out' }) => call<number>('flowCategory:create', input),
  update: (id: number, input: { name?: string; kind?: 'in' | 'out' }) =>
    call<void>('flowCategory:update', { id, ...input }),
  remove: (id: number) => call<void>('flowCategory:remove', id),
  disable: (id: number) => call<void>('flowCategory:disable', id),
  enable: (id: number) => call<void>('flowCategory:enable', id)
}
