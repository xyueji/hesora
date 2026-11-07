import { call } from './call'
import type {
  BatchQuery,
  PriceLevel,
  Product,
  ProductBatch,
  ProductQuery,
  ShelfLifeConfig
} from '../../../shared/types/product'
import type { PageResult } from '../../../shared/types/common'

export const productApi = {
  create: (p: Omit<Product, 'id'>) => call<number>('product:create', p),
  update: (id: number, p: Partial<Product>) => call<void>('product:update', { id, p }),
  get: (id: number) => call<Product | null>('product:get', id),
  getByBarcode: (barcode: string) => call<Product | null>('product:getByBarcode', barcode),
  query: (q: ProductQuery) => call<PageResult<Product>>('product:query', q),
  disable: (id: number) => call<void>('product:disable', id),
  enable: (id: number) => call<void>('product:enable', id),
  /** 读取商品价格等级（零售价/批发价/会员价…） */
  getPriceLevels: (productId: number) => call<PriceLevel[]>('product:priceLevels', { productId }),
  /** 整体覆盖商品价格等级 */
  setPriceLevels: (productId: number, levels: PriceLevel[]) =>
    call<void>('product:savePriceLevels', { productId, levels }),
  /** 保存保质期与临期预警提前天数 */
  setShelfLife: (productId: number, config: ShelfLifeConfig) =>
    call<void>('product:setShelfLife', { productId, config }),
  /** 批次效期列表（含剩余天数与 正常/临期/已过期 状态） */
  listBatches: (query: BatchQuery) =>
    call<{ list: ProductBatch[]; total: number }>('product:batches', query),
  /** 登记/更新批次效期（同一商品+仓库+批次号即更新同一条） */
  saveBatch: (
    productId: number,
    warehouseId: number,
    batchNo: string,
    data: { production_date?: string; expire_date?: string; remark?: string }
  ) => call<number>('product:saveBatch', { productId, warehouseId, batchNo, data })
}
