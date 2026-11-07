import type { Database } from 'better-sqlite3'
import type { FundLedgerAccount, FundLedgerEntry, FundTransferInput } from '../../../shared/types/fund-ledger'
import { BizError } from '../../../shared/result'

const LEGACY_RETURN_FILTER = `(f.doc_type NOT IN ('sale_return','purchase_return') OR EXISTS (
  SELECT 1 FROM doc d WHERE d.id = f.doc_id AND d.type = f.doc_type AND d.account_id = f.account_id
))`
const SIGNED_AMOUNT = `CASE f.direction WHEN 'in' THEN f.amount ELSE -f.amount END`

export function createFundLedger(db: Database) {
  const selectAccount = db.prepare('SELECT opening_balance, disabled FROM fund_account WHERE id = ?')
  const balanceAt = db.prepare(`SELECT ROUND(a.opening_balance + COALESCE(SUM(${SIGNED_AMOUNT}), 0), 2) AS balance
    FROM fund_account a LEFT JOIN fund_flow f ON f.account_id = a.id AND f.date <= ? AND ${LEGACY_RETURN_FILTER}
    WHERE a.id = ? GROUP BY a.id`)
  const insertTransfer = db.prepare(`INSERT INTO fund_transfer
    (no, from_account_id, to_account_id, date, amount, remark, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const flow = db.prepare(`INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark)
    VALUES (?, 'account_transfer', ?, ?, ?, ?, ?)`)

  function transfer(input: FundTransferInput, actor: number): { id: number; no: string } {
    return db.transaction(() => {
      if (input.from === input.to) throw new BizError('VALIDATION', '请选择不同的转出和转入账户')
      for (const accountId of [input.from, input.to]) {
        const account = Number.isInteger(accountId) ? selectAccount.get(accountId) as { disabled: number } | undefined : undefined
        if (!account || account.disabled) throw new BizError('VALIDATION', '请选择启用的资金账户')
      }
      const cents = Math.round(input.amount * 100)
      if (cents <= 0 || !Number.isSafeInteger(cents) || Math.abs(cents - input.amount * 100) > 1e-7) {
        throw new BizError('VALIDATION', '转账金额须大于零，且最多两位小数')
      }
      const parsed = new Date(`${input.date}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== input.date) {
        throw new BizError('VALIDATION', '请选择有效的转账日期')
      }
      const amount = cents / 100
      const { balance } = balanceAt.get(input.date, input.from) as { balance: number }
      if (balance < amount) throw new BizError('VALIDATION', '转出账户在转账日期的可用余额不足')
      const prefix = `ZZ${input.date.replaceAll('-', '')}`
      const sequence = db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(no, ?) AS INTEGER)), 0) + 1 FROM fund_transfer WHERE date = ?')
        .pluck().get(prefix.length + 1, input.date) as number
      const no = `${prefix}${String(sequence).padStart(4, '0')}`
      const remark = input.remark?.trim() || null
      const id = Number(insertTransfer.run(no, input.from, input.to, input.date, amount, remark, actor).lastInsertRowid)
      flow.run(input.from, id, amount, 'out', input.date, remark)
      flow.run(input.to, id, amount, 'in', input.date, remark)
      return { id, no }
    }).immediate()
  }

  return {
    transfer,
    accounts(): FundLedgerAccount[] {
      return db.prepare(`SELECT a.id, a.name, a.type, a.disabled, a.opening_balance,
        ROUND(a.opening_balance + COALESCE(SUM(${SIGNED_AMOUNT}), 0), 2) AS balance
        FROM fund_account a LEFT JOIN fund_flow f ON f.account_id = a.id AND ${LEGACY_RETURN_FILTER}
        GROUP BY a.id ORDER BY a.id`).all() as FundLedgerAccount[]
    },
    entries(accountId: number, page: number): { list: FundLedgerEntry[]; total: number } {
      if (!selectAccount.get(accountId)) throw new BizError('NOT_FOUND', '资金账户不存在')
      const total = db.prepare(`SELECT COUNT(*) FROM fund_flow f WHERE f.account_id = ? AND ${LEGACY_RETURN_FILTER}`)
        .pluck().get(accountId) as number
      const list = db.prepare(`SELECT f.id, COALESCE(d.no, t.no) AS no, f.doc_type AS type, f.date, f.amount, f.direction, f.remark,
        ROUND(a.opening_balance + SUM(${SIGNED_AMOUNT}) OVER (ORDER BY f.date, f.id), 2) AS balance
        FROM fund_flow f JOIN fund_account a ON a.id = f.account_id
        LEFT JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
        LEFT JOIN fund_transfer t ON t.id = f.doc_id AND f.doc_type = 'account_transfer'
        WHERE f.account_id = ? AND ${LEGACY_RETURN_FILTER} ORDER BY f.date DESC, f.id DESC LIMIT 30 OFFSET ?`)
        .all(accountId, (Math.max(1, Math.floor(Number(page)) || 1) - 1) * 30) as FundLedgerEntry[]
      return { list, total }
    }
  }
}
