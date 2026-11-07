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

export function createAuditService(db: Database) {
  return {
    record(action: string, operator: string | undefined, detail: string, before?: string, after?: string): void {
      db.prepare(
        'INSERT INTO platform_log (action, operator, detail, before_value, after_value, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(action, operator ?? null, detail, before ?? null, after ?? null, new Date().toISOString())
    },
    list(): AuditEntry[] {
      return db.prepare('SELECT * FROM platform_log ORDER BY id DESC LIMIT 100').all() as AuditEntry[]
    }
  }
}
