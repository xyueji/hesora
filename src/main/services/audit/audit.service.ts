import type { Database } from 'better-sqlite3'

export interface AuditEntry {
  id: number
  action: string
  operator: string | null
  detail: string
  before_value: string | null
  after_value: string | null
  created_at: string
}

export interface AuditQuery {
  page: number
  pageSize: number
  keyword?: string
  action?: string
  /** YYYY-MM-DD（含当日） */
  from?: string
  to?: string
}

export interface AuditPage {
  total: number
  list: AuditEntry[]
}

const DATE_LEN = 10

export function createAuditService(db: Database) {
  return {
    record(action: string, operator: string | undefined, detail: string, before?: string, after?: string): void {
      db.prepare(
        'INSERT INTO platform_log (action, operator, detail, before_value, after_value, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(action, operator ?? null, detail, before ?? null, after ?? null, new Date().toISOString())
    },
    list(): AuditEntry[] {
      return db.prepare('SELECT * FROM platform_log ORDER BY id DESC LIMIT 100').all() as AuditEntry[]
    },
    query(q: AuditQuery): AuditPage {
      const where: string[] = []
      const args: unknown[] = []
      if (q.keyword) {
        where.push('(detail LIKE ? OR operator LIKE ?)')
        const kw = `%${q.keyword}%`
        args.push(kw, kw)
      }
      if (q.action) {
        where.push('action = ?')
        args.push(q.action)
      }
      if (q.from) {
        where.push('created_at >= ?')
        args.push(`${q.from}T00:00:00`)
      }
      if (q.to) {
        where.push('created_at <= ?')
        // created_at 为 ISO 全时间戳；取 to 当日末尾（+23:59:59.999 前的一切）
        args.push(`${q.to.slice(0, DATE_LEN)}T23:59:59.999Z`)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM platform_log ${whereSql}`).get(...args) as { n: number }).n
      const pageSize = Math.max(1, q.pageSize)
      const offset = (Math.max(1, q.page) - 1) * pageSize
      const list = db
        .prepare(`SELECT * FROM platform_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...args, pageSize, offset) as AuditEntry[]
      return { total, list }
    }
  }
}
