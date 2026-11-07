import { call } from './call'
import type { FundLedgerAccount, FundLedgerEntry, FundTransferInput } from '../../../shared/types/fund-ledger'

export const fundLedgerApi = {
  accounts: () => call<FundLedgerAccount[]>('ledger:accounts'),
  entries: (accountId: number, page: number) => call<{ list: FundLedgerEntry[]; total: number }>('ledger:entries', { accountId, page }),
  transfer: (input: FundTransferInput) => call<{ id: number; no: string }>('ledger:transfer', input)
}
