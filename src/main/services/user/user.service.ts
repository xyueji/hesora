import type { Database } from 'better-sqlite3'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { BizError } from '../../../shared/result'
import type { PermissionKey } from '../../../shared/permissions'
import { roleHas } from '../../../shared/permissions'

type Role = 'admin' | 'cashier'

export interface SessionUser {
  id: number
  username: string
  role: Role
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  role: Role
  disabled: number
}

export interface SafeUser {
  id: number
  username: string
  role: Role
  disabled: number
  created_at: string
  updated_at: string | null
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function toSafe(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled,
    created_at: String((row as unknown as { created_at?: string }).created_at ?? ''),
    updated_at: String((row as unknown as { updated_at?: string | null }).updated_at ?? '') || null
  }
}

export function createUserService(db: Database) {
  function countActiveAdmins(excludeId?: number): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role='admin' AND disabled=0 AND id != ?`)
      .get(excludeId ?? -1) as { n: number }
    return row.n
  }

  function countAdmins(): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role='admin'`).get() as {
      n: number
    }
    return row.n
  }

  return {
    /** 应用启动时调用：仅当库里没有任何用户时，创建默认管理员 admin/admin123。 */
    ensureDefaultAdmin(): void {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }
      if (row.n > 0) return
      db.prepare(
        `INSERT INTO "user" (username, password_hash, role) VALUES (?, ?, 'admin')`
      ).run('admin', hashPassword('admin123'))
    },

    /** 登录校验；成功返回会话用户（不含哈希），失败（不存在/密码错/已停用）返回 null。 */
    verify(username: string, password: string): SessionUser | null {
      const row = db.prepare(`SELECT * FROM "user" WHERE username = ?`).get(username) as
        | UserRow
        | undefined
      if (!row) return null
      if (row.disabled) return null
      if (!checkPassword(password, row.password_hash)) return null
      return { id: row.id, username: row.username, role: row.role }
    },

    can(user: SessionUser | null, permission: PermissionKey): boolean {
      if (!user) return false
      return roleHas(user.role, permission)
    },

    create(input: { username: string; password: string; role: Role }): SafeUser {
      const username = String(input.username ?? '').trim()
      const password = String(input.password ?? '')
      const role = input.role
      if (!username) throw new BizError('VALIDATION', '用户名不能为空')
      if (!password) throw new BizError('VALIDATION', '密码不能为空')
      if (role !== 'admin' && role !== 'cashier')
        throw new BizError('VALIDATION', '角色必须是 admin 或 cashier')
      const dup = db.prepare(`SELECT id FROM "user" WHERE username = ?`).get(username)
      if (dup) throw new BizError('DUP_CODE', `用户名「${username}」已存在`)
      const info = db
        .prepare(`INSERT INTO "user" (username, password_hash, role) VALUES (?, ?, ?)`)
        .run(username, hashPassword(password), role)
      const row = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(info.lastInsertRowid) as UserRow
      return toSafe(row)
    },

    update(id: number, patch: { password?: string; role?: Role; disabled?: number | boolean }): SafeUser {
      const row = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(id) as UserRow | undefined
      if (!row) throw new BizError('NOT_FOUND', '用户不存在')
      const sets: string[] = []
      const vals: unknown[] = []
      if (patch.password !== undefined) {
        const password = String(patch.password)
        if (!password) throw new BizError('VALIDATION', '密码不能为空')
        sets.push('password_hash = ?')
        vals.push(hashPassword(password))
      }
      if (patch.role !== undefined) {
        if (patch.role !== 'admin' && patch.role !== 'cashier')
          throw new BizError('VALIDATION', '角色必须是 admin 或 cashier')
        sets.push('role = ?')
        vals.push(patch.role)
      }
      if (patch.disabled !== undefined) {
        const disabled = patch.disabled ? 1 : 0
        if (disabled === 1 && row.role === 'admin' && row.disabled === 0 && countActiveAdmins(id) === 0) {
          throw new BizError('VALIDATION', '至少保留一个管理员')
        }
        if (disabled === 0 && row.role === 'admin' && row.disabled === 1 && countAdmins() === 0) {
          throw new BizError('VALIDATION', '至少保留一个管理员')
        }
        sets.push('disabled = ?')
        vals.push(disabled)
      }
      // 角色 admin -> cashier 视为取消最后一个管理员
      if (patch.role === 'cashier' && row.role === 'admin' && countActiveAdmins(id) === 0) {
        throw new BizError('VALIDATION', '至少保留一个管理员')
      }
      if (sets.length > 0) {
        sets.push(`updated_at = datetime('now','localtime')`)
        vals.push(id)
        db.prepare(`UPDATE "user" SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
      }
      const updated = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(id) as UserRow
      return toSafe(updated)
    },

    query(): SafeUser[] {
      const rows = db.prepare(`SELECT * FROM "user" ORDER BY id`).all() as UserRow[]
      return rows.map(toSafe)
    },

    getById(id: number): SafeUser | null {
      const row = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(id) as UserRow | undefined
      return row ? toSafe(row) : null
    },

    remove(id: number): void {
      const row = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(id) as UserRow | undefined
      if (!row) throw new BizError('NOT_FOUND', '用户不存在')
      if (row.role === 'admin' && countAdmins() <= 1) {
        throw new BizError('VALIDATION', '至少保留一个管理员')
      }
      db.prepare(`DELETE FROM "user" WHERE id = ?`).run(id)
    }
  }
}

export type UserService = ReturnType<typeof createUserService>
