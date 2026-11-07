import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const DATABASE_FILENAME = 'hesora-inventory.db'
const LEGACY_DATABASE_FILENAME = 'zhjs-erp.db'

/** Upgrade the filename within the existing profile before opening the account. */
export function resolveDatabasePath(profile: string): string {
  mkdirSync(profile, { recursive: true })
  const destination = join(profile, DATABASE_FILENAME)
  const legacy = join(profile, LEGACY_DATABASE_FILENAME)
  if (!existsSync(legacy)) return destination
  if (existsSync(destination)) {
    throw new Error('数据目录中有两份账套。请备份两份文件并确认要使用的账套后重试。')
  }

  const db = new Database(legacy, { fileMustExist: true, timeout: 1000 })
  try {
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>
    if (checkpoint.some((result) => result.busy !== 0)) {
      throw new Error('旧账套正在使用，请关闭旧版程序后重试。')
    }
  } finally {
    db.close()
  }
  if (existsSync(`${legacy}-wal`) || existsSync(`${legacy}-shm`) || existsSync(`${legacy}-journal`)) {
    throw new Error('旧账套仍有数据库日志，请关闭旧版程序后重试。')
  }
  renameSync(legacy, destination)
  return destination
}
