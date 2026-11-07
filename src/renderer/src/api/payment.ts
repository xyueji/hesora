import { call } from './call'
import type { DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import type { PaymentCreateInput, PaymentDetail, PaymentType, SettlementDocument } from '../../../shared/types/payment'

export { type PaymentCreateInput, type PaymentDetail, type FundFlowRow } from '../../../shared/types/payment'

export const paymentApi = {
  openDocuments: (type: 'receipt' | 'payment', partnerId: number, docId?: number) =>
    call<SettlementDocument[]>('payment:openDocuments', { type, partnerId, docId }),
  create: (type: PaymentType, p: PaymentCreateInput) => call<DocRow>('payment:create', { type, p }),
  getDetail: (type: PaymentType, id: number) => call<PaymentDetail>('payment:getDetail', { type, id }),
  query: (type: PaymentType, q: Omit<DocQuery, 'type'>) => call<DocPageResult>('payment:query', { type, q }),
  createReceipt: (p: PaymentCreateInput) => call<DocRow>('payment:createReceipt', p),
  createPayment: (p: PaymentCreateInput) => call<DocRow>('payment:createPayment', p),
  getReceiptDetail: (id: number) => call<PaymentDetail>('payment:getReceiptDetail', id),
  getPaymentDetail: (id: number) => call<PaymentDetail>('payment:getPaymentDetail', id),
  queryReceipt: (q: Omit<DocQuery, 'type'>) => call<DocPageResult>('payment:queryReceipt', q),
  queryPayment: (q: Omit<DocQuery, 'type'>) => call<DocPageResult>('payment:queryPayment', q)
}
