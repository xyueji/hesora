// 单据查询中心 API：跨所有单据类型的通用查询与详情
import type { DocDetailWithItems, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { call } from './call'

export const docApi = {
  query: (q: DocQuery) => call<DocPageResult>('doc:query', q),
  getDetail: (id: number) => call<DocDetailWithItems>('doc:detail', id),
  /** 红冲已过账单据，返回负向镜像单 */
  reverse: (docId: number, operator?: string) => call<DocRow>('doc:reverse', { docId, operator }),
  /** 查某单的红冲单 */
  reversals: (docId: number) => call<DocRow[]>('doc:reversals', docId)
}
