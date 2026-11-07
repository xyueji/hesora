export const REPORT_LABELS = {
  sales: '销售统计',
  purchases: '采购统计',
  profit: '利润',
  fund: '资金流水',
  hot: '热销商品',
  stockSheet: '库存盘点表',
  stocktake: '盘盈盘亏'
} as const

export type ReportKind = keyof typeof REPORT_LABELS
export type ReportColumn = [key: string, label: string, money?: boolean]

const daily: ReportColumn[] = [['date', '日期'], ['count', '单据数'], ['gross', '原额（元）', true], ['returns', '退货（元）', true], ['amount', '净额（元）', true]]

export const REPORT_COLUMNS: Record<ReportKind, ReportColumn[]> = {
  sales: daily,
  purchases: daily,
  profit: [['date', '日期'], ['revenue', '净销售额（元）', true], ['cost', '出库成本净额（元）', true], ['profit', '毛利（元）', true]],
  fund: [['date', '日期'], ['no', '单号'], ['type', '类型'], ['account', '账户'], ['income', '收入（元）', true], ['expense', '支出（元）', true], ['remark', '备注']],
  hot: [['code', '商品编码'], ['name', '商品'], ['unit', '基本单位'], ['qty', '净销量'], ['amount', '净销售额（元）', true]],
  stockSheet: [['warehouse', '仓库'], ['code', '商品编码'], ['name', '商品'], ['batch_no', '批次'], ['unit', '基本单位'], ['book_qty', '当前账面数量']],
  stocktake: [['date', '日期'], ['no', '单号'], ['warehouse', '仓库'], ['code', '商品编码'], ['name', '商品'], ['batch_no', '批次'], ['unit', '基本单位'], ['book_qty', '账面数量'], ['actual_qty', '实盘数量'], ['diff', '差异']]
}

export interface ReportQuery {
  kind: ReportKind
  date_from?: string
  date_to?: string
  warehouse_id?: number
  account_id?: number
  direction?: 'in' | 'out'
  keyword?: string
  page?: number
  pageSize?: number
}

export type ReportRow = Record<string, string | number | null>

export interface ReportPage {
  rows: ReportRow[]
  total: number
  totals?: { income: number; expense: number }
}
