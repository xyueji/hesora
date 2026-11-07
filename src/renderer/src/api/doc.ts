// 单据查询中心 API：跨所有单据类型的通用查询与详情
import type { DocDetailWithItems, DocPageResult, DocQuery } from '../../../shared/types/doc'
import { call } from './call'

export const docApi = {
  query: (q: DocQuery) => call<DocPageResult>('doc:query', q),
  getDetail: (id: number) => call<DocDetailWithItems>('doc:detail', id)
}
