// 单据查询中心 API：跨所有单据类型的通用查询与详情
import type { DocDetailWithItems, DocPageResult, DocQuery } from '../../../shared/types/doc'
import type { Result } from '../../../shared/result'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const docApi = {
  query: (q: DocQuery) => call<DocPageResult>('doc:query', q),
  getDetail: (id: number) => call<DocDetailWithItems>('doc:detail', id)
}
