import { call } from './call'
import type { CustomerPriceRow, PriceChangeLogRow, ChangeLogQuery } from '../../../shared/types/customer-price'

export const customerPriceApi = {
  /** 设置（新建/覆盖）客户×商品专属价 */
  set: (customerId: number, productId: number, price: number) =>
    call<CustomerPriceRow>('customerPrice:set', { customerId, productId, price }),
  /** 删除客户×商品专属价 */
  remove: (customerId: number, productId: number) =>
    call<void>('customerPrice:remove', { customerId, productId }),
  listByCustomer: (customerId: number) => call<CustomerPriceRow[]>('customerPrice:listByCustomer', customerId),
  listByProduct: (productId: number) => call<CustomerPriceRow[]>('customerPrice:listByProduct', productId),
  changeLog: (query: ChangeLogQuery = {}) => call<PriceChangeLogRow[]>('customerPrice:changeLog', query)
}
