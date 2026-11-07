import { call } from './call'
import type {
  AdjustPriceItem,
  AdjustPriceResult,
  CostChangePage,
  CostChangeQuery,
  SetWarningsByConditionInput,
  SetWarningsResult,
  StatsDetailPage,
  StatsDetailQuery,
  StockFlowQuery,
  StockFlowResult,
  WarningPage,
  WarningQuery
} from '../../../shared/types/stock-report'

export const stockReportApi = {
  /** 库存统计明细（按商品/仓库/批次下钻） */
  statisticsDetail: (q: StatsDetailQuery) => call<StatsDetailPage>('stock:statisticsDetail', q),
  /** 成本变动明细（cost_log 台账） */
  costChanges: (q: CostChangeQuery) => call<CostChangePage>('stock:costChanges', q),
  /** 库存流水（收发存） */
  stockFlow: (q: StockFlowQuery) => call<StockFlowResult>('stock:flows', q),
  /** 库存预警清单 */
  warnings: (q: WarningQuery) => call<WarningPage>('stock:warnings', q),
  /** 设置单个商品预警值 */
  setWarning: (productId: number, minStock: number) =>
    call<void>('stock:setWarning', { product_id: productId, min_stock: minStock }),
  /** 按条件批量设置预警值 */
  setWarningsByCondition: (condition: SetWarningsByConditionInput, minStock: number) =>
    call<SetWarningsResult>('stock:setWarningsByCondition', { condition, min_stock: minStock }),
  /** 批量调整售价并留痕 */
  adjustPrices: (items: AdjustPriceItem[], operator?: string) =>
    call<AdjustPriceResult>('stock:adjustPrices', { items, operator })
}
