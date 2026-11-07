import { afterEach, beforeEach, expect, it } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createFundLedger } from '../../src/main/services/fund/ledger.service'

let db: ReturnType<typeof openMemDb>
let from: number
let to: number

beforeEach(() => {
  db = openMemDb()
  const funds = createFundService(db)
  from = funds.create({ name: '现金', type: 'cash', opening_balance: 120 })
  to = funds.create({ name: '银行', type: 'bank', opening_balance: 20 })
})
afterEach(() => db.close())

it('records both legs of a transfer and preserves the combined account balance', () => {
  const ledger = createFundLedger(db)
  const receipt = ledger.transfer({ from, to, amount: 50.25, date: '2026-11-07', remark: '营业款入账' }, 1)
  expect(ledger.accounts().map((account) => account.balance)).toEqual([69.75, 70.25])
  expect(ledger.entries(from, 1).list[0]).toMatchObject({ no: receipt.no, direction: 'out', amount: 50.25, balance: 69.75 })
  expect(ledger.entries(to, 1).list[0]).toMatchObject({ no: receipt.no, direction: 'in', amount: 50.25, balance: 70.25 })
})

it('rejects invalid and underfunded transfers without changing the ledger', () => {
  const ledger = createFundLedger(db)
  expect(() => ledger.transfer({ from, to, amount: 150, date: '2026-11-07' }, 1)).toThrow(/余额不足/)
  expect(() => ledger.transfer({ from, to: from, amount: 5, date: '2026-11-07' }, 1)).toThrow(/不同/)
  expect(() => ledger.transfer({ from, to, amount: 5.001, date: '2026-11-07' }, 1)).toThrow(/两位/)
  expect(ledger.entries(from, 1).total).toBe(0)
  expect(ledger.accounts().map((account) => account.balance)).toEqual([120, 20])
})

it('rolls back both transfer legs when the destination leg cannot be written', () => {
  const ledger = createFundLedger(db)
  db.exec("CREATE TRIGGER reject_credit BEFORE INSERT ON fund_flow WHEN NEW.direction = 'in' BEGIN SELECT RAISE(ABORT, 'test write failure'); END")
  expect(() => ledger.transfer({ from, to, amount: 5, date: '2026-11-07' }, 1)).toThrow(/test write failure/)
  expect(ledger.entries(from, 1).total).toBe(0)
  expect(db.prepare('SELECT COUNT(*) FROM fund_transfer').pluck().get()).toBe(0)
})
