import { call } from './call'
import type {
  ConsumeSerialInput,
  RegisterSerialInput,
  SerialFlowPageResult,
  SerialFlowQuery,
  SerialStockPageResult,
  SerialStockQuery,
  SerialTraceResult,
  ValidateSnResult
} from '../../../shared/types/serial'

export const serialApi = {
  /** 入库登记序列号（重复登记报 DUP_CODE） */
  registerIn: (items: RegisterSerialInput[]) =>
    call<{ count: number; ids: number[] }>('serial:registerIn', { items }),
  /** 出库核销序列号（未入库/已出库报 NOT_FOUND） */
  consumeOut: (items: ConsumeSerialInput[]) =>
    call<{ count: number; ids: number[] }>('serial:consumeOut', { items }),
  /** 序列号台账（在库/已出） */
  stock: (q: SerialStockQuery) => call<SerialStockPageResult>('serial:stock', q),
  /** 序列号流水（出入记录） */
  flows: (q: SerialFlowQuery) => call<SerialFlowPageResult>('serial:flows', q),
  /** 保存单据前的序列号预校验 */
  validate: (productId: number, sns: string[], direction: 'in' | 'out' = 'in') =>
    call<ValidateSnResult>('serial:validate', { productId, sns, direction }),
  /** 某商品在库序列号数 */
  stockOf: (productId: number) => call<number>('serial:stockOf', productId),
  /** 序列号去向：完整事件链 + 当前位置 */
  trace: (sn: string) => call<SerialTraceResult>('serial:trace', sn)
}
