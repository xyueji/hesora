import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function runMigrations(db: Database.Database, dir = join(__dirname, 'migrations')): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const ver = Number(f.split('_')[0])
    if (ver <= current) continue
    db.transaction(() => {
      db.exec(readFileSync(join(dir, f), 'utf8'))
    })()
    db.pragma(`user_version = ${ver}`)
  }
}
