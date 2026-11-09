// P2：商品自定义属性字典 API。
import { call } from './call'
import type { ProductAttribute } from '../../../shared/types/product'

export const productAttributeApi = {
  list: () => call<ProductAttribute[]>('productAttribute:list'),
  create: (p: { name: string; options?: string[] }) =>
    call<ProductAttribute>('productAttribute:create', p),
  update: (id: number, p: { name?: string; options?: string[] }) =>
    call<ProductAttribute>('productAttribute:update', { id, ...p }),
  remove: (id: number) => call<void>('productAttribute:remove', id)
}
