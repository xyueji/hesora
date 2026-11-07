export interface FundTransferInput {
  from: number
  to: number
  date: string
  amount: number
  remark?: string
}

export interface FundLedgerAccount {
  id: number
  name: string
  type: string
  disabled: number
  opening_balance: number
  balance: number
}

export interface FundLedgerEntry {
  id: number
  no: string | null
  type: string
  date: string
  amount: number
  direction: 'in' | 'out'
  remark: string | null
  balance: number
}
