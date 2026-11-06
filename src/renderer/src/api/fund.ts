import type { Result } from '../../../shared/result'
import type { FundAccount, FundAccountQuery } from '../../../shared/types/fund'
import type { PageResult } from '../../../shared/types/common'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const fundApi = {
  create: (p: Omit<FundAccount, 'id'>) => call<number>('fund:create', p),
  update: (id: number, p: Partial<FundAccount>) => call<void>('fund:update', { id, p }),
  get: (id: number) => call<FundAccount | null>('fund:get', id),
  query: (q: FundAccountQuery) => call<PageResult<FundAccount>>('fund:query', q),
  disable: (id: number) => call<void>('fund:disable', id),
  enable: (id: number) => call<void>('fund:enable', id)
}
