import Database from 'better-sqlite3'
import { runMigrations } from './migrate'

export type DB = Database.Database

export function openDb(filePath: string, migrationsDir: string): DB {
  const db = new Database(filePath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db, migrationsDir)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)()
}
