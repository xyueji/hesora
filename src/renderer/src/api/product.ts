import type { Result } from '../../../shared/result'
import type { Product, ProductQuery } from '../../../shared/types/product'
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

export const productApi = {
  create: (p: Omit<Product, 'id'>) => call<number>('product:create', p),
  update: (id: number, p: Partial<Product>) => call<void>('product:update', { id, p }),
  get: (id: number) => call<Product | null>('product:get', id),
  query: (q: ProductQuery) => call<PageResult<Product>>('product:query', q),
  disable: (id: number) => call<void>('product:disable', id),
  enable: (id: number) => call<void>('product:enable', id)
}
