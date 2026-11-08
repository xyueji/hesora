import type { Database } from 'better-sqlite3'
import type { AgingRow, AgingResult, ArrearsRow, ArrearsSummary } from '../../../shared/types/stats'

export type DB = Database

/**
 * 往来余额 = 期初 + 购销净额 − 结算净额 + 退货冲减。
 * 挂账退货直接冲减购销额（doc 全量口径）；
 * 实退现金的流水（fund_flow，022 起带 partner_id）双向对冲：
 * 退货冲减购销额、现金退款冲减结算额，余额不变——即客户已拿回现金，不再欠这笔。
 * fund_flow.partner_id 为 NULL 的旧数据经 doc JOIN 兜底归属往来单位。
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

  /**
   * P2-2 账龄报表：截至 asOf（默认今天），把每个往来单位的未结余额按
   * 单据账龄（asOf − doc.date）分档。核销按先进先出（最早的单据先核销），
   * 因此未结金额归属到最"老"的单据上；期初余额视作最老一档（90+）。
   * 金额口径与 queryBalances 一致（退货冲减、含税总额、done 单据）。
   */
  function aging(asOf = new Date().toISOString().slice(0, 10)): AgingResult {
    const build = (partner: 'customer' | 'supplier'): AgingRow[] => {
      const customer = partner === 'customer'
      const opening = customer ? 'opening_receivable' : 'opening_payable'
      const tradeTypes = customer ? "'sale', 'retail'" : "'purchase'"
      const returnType = customer ? 'sale_return' : 'purchase_return'
      const rows = db.prepare(`
        SELECT p.id AS partner_id, p.name AS partner_name, d.id AS doc_id, d.date AS doc_date,
          CASE WHEN d.type = @returnType THEN -d.total_amount ELSE d.total_amount END AS amount
        FROM doc d JOIN ${partner} p ON p.id = d.partner_id AND p.disabled = 0
        WHERE d.status = 'done' AND d.type IN (${tradeTypes}, @returnType) AND d.date <= @asOf
          AND (d.type = @returnType OR d.total_amount <> 0)
      `).all({ returnType, asOf }) as
        { partner_id: number; partner_name: string; doc_id: number; doc_date: string; amount: number }[]

      // 期初余额也进账龄：记为 90+ 档，日期取最早单据更早一天（或 asOf 前推）
      const byPartner = new Map<number, AgingRow>()
      const bucketOf = (date: string): keyof Pick<AgingRow, 'b0_30' | 'b31_60' | 'b61_90' | 'b90plus'> => {
        const days = Math.floor((Date.parse(asOf) - Date.parse(date)) / 86400000)
        return days <= 30 ? 'b0_30' : days <= 60 ? 'b31_60' : days <= 90 ? 'b61_90' : 'b90plus'
      }
      const ensure = (id: number, name: string): AgingRow => {
        let row = byPartner.get(id)
        if (!row) {
          row = { partner_id: id, partner_name: name, total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, oldest: null }
          byPartner.set(id, row)
        }
        return row
      }

      // 核销分摊准备：结算按 partner 汇总后对交易单 FIFO 抵扣
      const settledByPartner = new Map<number, number>()
      const settleRows = db.prepare(`
        SELECT d.partner_id, SUM(
          CASE WHEN f.doc_type = @returnType THEN -f.amount ELSE f.amount END) AS amount
        FROM fund_flow f JOIN doc d ON d.id = f.doc_id AND d.type = f.doc_type
        WHERE d.status = 'done' AND d.date <= @asOf AND (
          (f.doc_type IN ('receipt', 'payment', 'retail') AND f.direction = @direction)
          OR (f.doc_type = @returnType AND f.direction = @refundDirection AND f.account_id = d.account_id)
        )
        GROUP BY d.partner_id
      `).all({ returnType, direction: customer ? 'in' : 'out', refundDirection: customer ? 'out' : 'in', asOf }) as
        { partner_id: number; amount: number }[]
      for (const s of settleRows) settledByPartner.set(s.partner_id, s.amount)

      // 结算总额按 partner 汇总后 FIFO 抵扣交易单（按 date,id 升序）
      const tradeByPartner = new Map<number, { date: string; amount: number }[]>()
      for (const r of rows) {
        const list = tradeByPartner.get(r.partner_id) ?? []
        list.push({ date: r.doc_date, amount: r.amount })
        tradeByPartner.set(r.partner_id, list)
      }

      const nameOf = new Map<number, string>()
      for (const r of rows) nameOf.set(r.partner_id, r.partner_name)

      for (const [pid, trades] of tradeByPartner) {
        trades.sort((a, b) => a.date.localeCompare(b.date))
        let credit = settledByPartner.get(pid) ?? 0
        for (const t of trades) {
          const outstanding = credit > 0 ? Math.max(0, t.amount - credit) : t.amount
          if (credit > 0) credit = Math.max(0, credit - t.amount)
          if (outstanding === 0) continue
          const row = ensure(pid, nameOf.get(pid) ?? '')
          const key = bucketOf(t.date)
          row[key] = Math.round((row[key] + outstanding) * 100) / 100
          row.total = Math.round((row.total + outstanding) * 100) / 100
          if (!row.oldest || t.date < row.oldest) row.oldest = t.date
        }
      }

      // 期初余额：归入 90+ 档
      const openings = db.prepare(`SELECT id, name, ${opening} AS opening FROM ${partner} WHERE disabled = 0 AND ${opening} <> 0`).all() as
        { id: number; name: string; opening: number }[]
      for (const o of openings) {
        const row = ensure(o.id, o.name)
        row.b90plus = Math.round((row.b90plus + o.opening) * 100) / 100
        row.total = Math.round((row.total + o.opening) * 100) / 100
      }

      return [...byPartner.values()].sort((a, b) => b.total - a.total)
    }
    return { asOf, customers: build('customer'), suppliers: build('supplier') }
  }

  return { receivables, payables, summary, aging }
}

export type ArrearsService = ReturnType<typeof createArrearsService>
