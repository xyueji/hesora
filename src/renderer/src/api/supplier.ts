import type { Result } from '../../../shared/result'
import type { Supplier, SupplierQuery } from '../../../shared/types/supplier'
import type { PageResult } from '../../../shared/types/common'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const supplierApi = {
  create: (p: Omit<Supplier, 'id'>) => call<number>('supplier:create', p),
  update: (id: number, p: Partial<Supplier>) => call<void>('supplier:update', { id, p }),
  get: (id: number) => call<Supplier | null>('supplier:get', id),
  query: (q: SupplierQuery) => call<PageResult<Supplier>>('supplier:query', q),
  disable: (id: number) => call<void>('supplier:disable', id),
  enable: (id: number) => call<void>('supplier:enable', id)
}
