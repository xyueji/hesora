import Database from 'better-sqlite3'
import { runMigrations } from './migrate'

export type DB = Database.Database

export function openDb(filePath: string, migrationsDir: string): DB {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrationsDir)
  return db
}

export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)()
}
