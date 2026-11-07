import { call } from './call'

export interface CategoryRow {
  id: number
  name: string
  kind: 'income' | 'expense'
  disabled: 0 | 1
  created_at: string
}

export const categoryApi = {
  list: (query?: { include_disabled?: boolean; kind?: 'income' | 'expense' }) =>
    call<CategoryRow[]>('category:list', query ?? {}),
  create: (input: { name: string; kind: 'income' | 'expense' }) =>
    call<number>('category:create', input),
  update: (id: number, input: { name?: string; kind?: 'income' | 'expense' }) =>
    call<void>('category:update', { id, ...input }),
  remove: (id: number) => call<void>('category:remove', id),
  disable: (id: number) => call<void>('category:disable', id),
  enable: (id: number) => call<void>('category:enable', id)
}
