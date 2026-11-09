import Database from 'better-sqlite3'
import { runMigrations } from './migrate'

export type DB = Database.Database

export function openDb(filePath: string, migrationsDir: string): DB {
  const db = new Database(filePath)
  try {
    db.pragma('journal_mode = WAL')
    // 迁移可能包含 DROP TABLE + 重建（如 061 的 doc 表 CHECK 扩展），须在 foreign_keys=OFF
    // 下执行（见 061 注释"此文件运行时 foreign_keys 已由调用方关闭"）；迁移完成后恢复。
    db.pragma('foreign_keys = OFF')
    runMigrations(db, migrationsDir)
    db.pragma('foreign_keys = ON')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)()
}
