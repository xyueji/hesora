import type { Result } from '../../../shared/result'
import type { Customer, CustomerQuery } from '../../../shared/types/customer'
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

export const customerApi = {
  create: (p: Omit<Customer, 'id'>) => call<number>('customer:create', p),
  update: (id: number, p: Partial<Customer>) => call<void>('customer:update', { id, p }),
  get: (id: number) => call<Customer | null>('customer:get', id),
  query: (q: CustomerQuery) => call<PageResult<Customer>>('customer:query', q),
  disable: (id: number) => call<void>('customer:disable', id),
  enable: (id: number) => call<void>('customer:enable', id)
}
