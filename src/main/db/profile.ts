import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 应用数据目录（userData）改名。
 * 旧品牌使用 zhjs-erp 目录，新品牌使用 hesora-inventory。
 * 首次启动时若旧目录存在且新目录不存在，则整目录迁移，保留账套、备份与设置。
 */
export const PROFILE_DIRNAME = 'hesora-inventory'
export const LEGACY_PROFILE_DIRNAME = 'zhjs-erp'

/** 迁移旧 profile 目录；返回最终使用的目录绝对路径。 */
export function resolveProfilePath(appData: string): string {
  const target = join(appData, PROFILE_DIRNAME)
  const legacy = join(appData, LEGACY_PROFILE_DIRNAME)
  if (!existsSync(legacy) || existsSync(target)) return target

  // 迁移前先让旧账套落盘，避免 WAL 数据随目录搬走时丢页。
  const legacyDb = join(legacy, 'zhjs-erp.db')
  if (existsSync(legacyDb)) {
    const db = new Database(legacyDb, { fileMustExist: true, timeout: 1000 })
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
  }

  try {
    renameSync(legacy, target)
  } catch {
    // 目录被占用（用户未退出旧版）时保留旧目录，下一次启动再迁移。
    return legacy
  }
  return target
}

/** 首次运行时创建 profile 目录。 */
export function ensureProfileDir(profile: string): string {
  mkdirSync(profile, { recursive: true })
  return profile
}
