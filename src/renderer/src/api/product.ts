import { call } from './call'
import type { Product, ProductQuery } from '../../../shared/types/product'
import type { PageResult } from '../../../shared/types/common'

export const productApi = {
  create: (p: Omit<Product, 'id'>) => call<number>('product:create', p),
  update: (id: number, p: Partial<Product>) => call<void>('product:update', { id, p }),
  get: (id: number) => call<Product | null>('product:get', id),
  getByBarcode: (barcode: string) => call<Product | null>('product:getByBarcode', barcode),
  query: (q: ProductQuery) => call<PageResult<Product>>('product:query', q),
  disable: (id: number) => call<void>('product:disable', id),
  enable: (id: number) => call<void>('product:enable', id)
}
