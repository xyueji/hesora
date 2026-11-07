import { call } from './call'
import type { CostLogRow, StockPageResult, StockQuery } from '../../../shared/types/inventory'

export const inventoryApi = {
  queryStock: (q: StockQuery) => call<StockPageResult>('inventory:queryStock', q),
  listCostLogs: (productId: number) => call<CostLogRow[]>('inventory:listCostLogs', productId)
}
