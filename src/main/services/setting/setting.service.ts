import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

interface SettingRow {
  key: string
  value: string
}

export function createSettingService(db: DB) {
  return {
    set(key: string, value: string): void {
      if (typeof key !== 'string' || key.trim() === '') {
        throw new BizError('VALIDATION', '设置键不能为空')
      }
      db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(
        key,
        String(value)
      )
    },

    get(key: string): string | null {
      const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
        | SettingRow
        | undefined
      return row ? row.value : null
    },

    getAll(): Record<string, string> {
      const rows = db.prepare('SELECT key, value FROM app_setting').all() as SettingRow[]
      const out: Record<string, string> = {}
      for (const r of rows) out[r.key] = r.value
      return out
    },

    remove(key: string): void {
      db.prepare('DELETE FROM app_setting WHERE key = ?').run(key)
    }
  }
}

export type SettingService = ReturnType<typeof createSettingService>
