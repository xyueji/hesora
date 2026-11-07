import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'

export type DB = Database

interface SettingRow {
  key: string
  value: string
}

const isManagedKey = (key: string): boolean => /^(license|sync)\./i.test(key)

export function createSettingService(db: DB) {
  return {
    set(key: string, value: string): void {
      if (typeof key !== 'string' || key.trim() === '') {
        throw new BizError('VALIDATION', '设置键不能为空')
      }
      if (isManagedKey(key)) throw new BizError('VALIDATION', '请在授权或同步页面管理此设置')
      db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(
        key,
        String(value)
      )
    },

    get(key: string): string | null {
      if (isManagedKey(key)) return null
      const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
        | SettingRow
        | undefined
      return row ? row.value : null
    },

    getAll(): Record<string, string> {
      const rows = db.prepare('SELECT key, value FROM app_setting').all() as SettingRow[]
      const out: Record<string, string> = {}
      for (const r of rows) if (!isManagedKey(r.key)) out[r.key] = r.value
      return out
    },

    remove(key: string): void {
      if (isManagedKey(key)) throw new BizError('VALIDATION', '请在授权或同步页面管理此设置')
      db.prepare('DELETE FROM app_setting WHERE key = ?').run(key)
    }
  }
}

export type SettingService = ReturnType<typeof createSettingService>
