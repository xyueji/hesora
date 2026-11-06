import Database from 'better-sqlite3'
import { runMigrations } from '../../src/main/db/migrate'
import { join } from 'node:path'

export function openMemDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, join(__dirname, '../../src/main/db/migrations'))
  return db
}
