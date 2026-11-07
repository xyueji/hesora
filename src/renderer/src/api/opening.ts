import { call } from './call'
import type { OpeningPayload, OpeningStatus } from '../../../shared/types/opening'

export const openingApi = {
  save: (payload: OpeningPayload) => call<void>('opening:save', payload),
  getStatus: () => call<OpeningStatus>('opening:getStatus')
}
