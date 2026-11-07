import type { Database } from 'better-sqlite3'
import type { ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'

export type DB = Database

/**
 * 往来余额 = 期初 + 购销净额 − 结算净额。
 * 退款冲减结算额，退货冲减购销额。现金退款与退货同时记账时余额不变。
 */
export function createArrearsService(db: DB) {
  function queryBalances(partner: 'customer' | 'supplier'): ArrearsRow[] {
    const customer = partner === 'customer'
    const opening = customer ? 'opening_receivable' : 'opening_payable'
    const tradeTypes = customer ? "'sale', 'retail'" : "'purchase'"
    const settlementTypes = customer ? "'receipt', 'retail'" : "'payment'"
    const returnType = customer ? 'sale_return' : 'purchase_return'
    const direction = customer ? 'in' : 'out'
    const refundDirection = customer ? 'out' : 'in'
    return db.prepare(`
      WITH traded AS (
        SELECT partner_id,
          SUM(CASE WHEN type = @returnType THEN -total_amount ELSE total_amount END) AS amount
        FROM doc
        WHERE status = 'done' AND type IN (${tradeTypes}, @returnType)
        GROUP BY partner_id
      ),
      settled AS (
        SELECT d.partner_id,
          SUM(CASE WHEN f.doc_type = @returnType THEN -f.amount ELSE f.amount END) AS amount
        FROM fund_flow f JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
        WHERE d.status = 'done' AND (
          (f.doc_type IN (${settlementTypes}) AND f.direction = @direction)
          OR (f.doc_type = @returnType AND f.direction = @refundDirection AND f.account_id = d.account_id)
        )
        GROUP BY d.partner_id
      )
      SELECT p.id AS partner_id, p.name AS partner_name, p.${opening} AS opening,
        COALESCE(t.amount, 0) AS amount, COALESCE(s.amount, 0) AS settled,
        p.${opening} + COALESCE(t.amount, 0) - COALESCE(s.amount, 0) AS balance
      FROM ${partner} p
      LEFT JOIN traded t ON t.partner_id = p.id
      LEFT JOIN settled s ON s.partner_id = p.id
      WHERE p.disabled = 0
      ORDER BY balance DESC, partner_id
    `).all({ returnType, direction, refundDirection }) as ArrearsRow[]
  }

  const receivables = (): ArrearsRow[] => queryBalances('customer')
  const payables = (): ArrearsRow[] => queryBalances('supplier')

  const summary = (): ArrearsSummary => {
    const sum = (rows: ArrearsRow[]): number => rows.reduce((acc, r) => acc + r.balance, 0)
    return { total_receivable: sum(receivables()), total_payable: sum(payables()) }
  }

  return { receivables, payables, summary }
}

export type ArrearsService = ReturnType<typeof createArrearsService>
