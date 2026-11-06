import type { Result } from '../../../shared/result'
import type { DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import type { PaymentCreateInput, PaymentDetail } from '../../../shared/types/payment'

export { type PaymentCreateInput, type PaymentDetail, type FundFlowRow } from '../../../shared/types/payment'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const paymentApi = {
  createReceipt: (p: PaymentCreateInput) => call<DocRow>('payment:createReceipt', p),
  createPayment: (p: PaymentCreateInput) => call<DocRow>('payment:createPayment', p),
  getReceiptDetail: (id: number) => call<PaymentDetail>('payment:getReceiptDetail', id),
  getPaymentDetail: (id: number) => call<PaymentDetail>('payment:getPaymentDetail', id),
  queryReceipt: (q: Omit<DocQuery, 'type'>) => call<DocPageResult>('payment:queryReceipt', q),
  queryPayment: (q: Omit<DocQuery, 'type'>) => call<DocPageResult>('payment:queryPayment', q)
}
