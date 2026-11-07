import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function runMigrations(db: Database.Database, dir = join(__dirname, 'migrations')): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const latest = Number(files.at(-1)?.split('_')[0] ?? 0)
  if (current > latest) throw new Error('此账套由更高版本创建，请用相应版本打开。')
  if (current === latest) return
  db.transaction(() => {
    for (const f of files) {
      const version = Number(f.split('_')[0])
      if (version <= current) continue
      db.exec(readFileSync(join(dir, f), 'utf8'))
      db.pragma(`user_version = ${version}`)
    }
  })()
}
