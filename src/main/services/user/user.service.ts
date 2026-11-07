import type { Database } from 'better-sqlite3'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { BizError } from '../../../shared/result'
import {
  ADMIN_ONLY_PERMISSIONS, ROLE_PRESETS, isPermissionKey, roleHas,
  type AccessRole, type PermissionKey, type RoleInput, type SessionUser
} from '../../../shared/permissions'

export type { SessionUser } from '../../../shared/permissions'

const BUILTIN_NAMES = { admin: '管理员', cashier: '收银员' } as const

interface StoredRole {
  id: string
  name: string
  permissions: string
}

function decodePermissions(raw: string): PermissionKey[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(isPermissionKey).filter((key) => !ADMIN_ONLY_PERMISSIONS.includes(key))
      : []
  } catch {
    return []
  }
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  role: string
  access_role_id: string | null
  disabled: number
  created_at: string
  updated_at: string | null
}

export interface SafeUser {
  id: number
  username: string
  role: string
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
    role: row.access_role_id ?? row.role,
    disabled: row.disabled,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export function createUserService(db: Database) {
  function toRole(row: StoredRole): AccessRole {
    return { id: row.id, name: row.name, permissions: decodePermissions(row.permissions), builtin: false }
  }

  function listRoles(): AccessRole[] {
    const builtins = (['admin', 'cashier'] as const).map((id) => ({
      id, name: BUILTIN_NAMES[id], permissions: [...ROLE_PRESETS[id]], builtin: true
    }))
    const rows = db.prepare('SELECT * FROM access_role ORDER BY name, id').all() as StoredRole[]
    return [...builtins, ...rows.map(toRole)]
  }

  function customRole(id: string): StoredRole | undefined {
    return db.prepare('SELECT * FROM access_role WHERE id = ?').get(id) as StoredRole | undefined
  }

  function requireCustomRole(id: string): StoredRole {
    if (id === 'admin' || id === 'cashier') throw new BizError('VALIDATION', '内置角色不可修改或删除')
    const role = customRole(id)
    if (!role) throw new BizError('NOT_FOUND', '角色不存在')
    return role
  }

  function normalizeRole(input: RoleInput, id?: string): RoleInput {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 40) throw new BizError('VALIDATION', '请输入 1 至 40 个字符的角色名称')
    if (!Array.isArray(input.permissions) || input.permissions.some((key) =>
      !isPermissionKey(key) || ADMIN_ONLY_PERMISSIONS.includes(key)
    )) throw new BizError('VALIDATION', '存在无效或仅限管理员的权限')
    const taken = db.prepare('SELECT id FROM access_role WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined
    if ((taken && taken.id !== id) || Object.values(BUILTIN_NAMES).some((label) => label === name) ||
        Object.hasOwn(BUILTIN_NAMES, name.toLowerCase())) {
      throw new BizError('DUP_CODE', '角色名称已存在')
    }
    return { name, permissions: [...new Set(input.permissions)] }
  }

  function roleColumns(role: string): [string, string | null] {
    if (role === 'admin' || role === 'cashier') return [role, null]
    if (typeof role !== 'string' || !customRole(role)) throw new BizError('VALIDATION', '请选择有效的角色')
    return ['cashier', role]
  }

  function toSession(row: UserRow): SessionUser | null {
    if (row.disabled) return null
    if (row.access_role_id === null) return { id: row.id, username: row.username, role: row.role }
    const role = customRole(row.access_role_id)
    return role ? {
      id: row.id,
      username: row.username,
      role: role.id,
      roleName: role.name,
      permissions: decodePermissions(role.permissions)
    } : null
  }
  function countActiveAdmins(excludeId?: number): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role='admin' AND disabled=0 AND id != ?`)
      .get(excludeId ?? -1) as { n: number }
    return row.n
  }

  function setupStatus(): { required: boolean; username?: string } {
    const activeAdmins = db.prepare(`SELECT * FROM "user" WHERE role='admin' AND disabled=0`).all() as UserRow[]
    const [admin] = activeAdmins
    if (!admin && !db.prepare('SELECT 1 FROM "user" LIMIT 1').get()) return { required: true }
    if (activeAdmins.length === 1 && admin?.username === 'admin' && checkPassword('admin123', admin.password_hash)) {
      return { required: true, username: 'admin' }
    }
    return { required: false }
  }

  const setupAdmin = db.transaction((username: string, password: string): SessionUser => {
    const status = setupStatus()
    if (!status.required) throw new BizError('NO_PERMISSION', '管理员已经设置')
    const name = username.trim()
    if (!name || name.length > 64) throw new BizError('VALIDATION', '请输入 1 至 64 个字符的用户名')
    if (password.length < 8 || password.length > 128 || !password.trim() || password === 'admin123') {
      throw new BizError('VALIDATION', '请设置 8 至 128 个字符的新密码')
    }
    if (status.username) {
      if (name !== status.username) throw new BizError('VALIDATION', '请为现有管理员设置新密码')
      db.prepare(`UPDATE "user" SET password_hash=?, updated_at=datetime('now','localtime') WHERE username=?`).run(hashPassword(password), name)
    } else {
      db.prepare(`INSERT INTO "user" (username, password_hash, role) VALUES (?, ?, 'admin')`).run(name, hashPassword(password))
    }
    const row = db.prepare('SELECT id FROM "user" WHERE username=?').get(name) as { id: number }
    return { id: row.id, username: name, role: 'admin' }
  })

  return {
    listRoles,

    createRole(input: RoleInput): AccessRole {
      const role = normalizeRole(input)
      const id = randomUUID()
      db.prepare('INSERT INTO access_role (id, name, permissions) VALUES (?, ?, ?)')
        .run(id, role.name, JSON.stringify(role.permissions))
      return { id, ...role, builtin: false }
    },

    updateRole(id: string, patch: Partial<RoleInput>): AccessRole {
      const stored = requireCustomRole(id)
      const role = normalizeRole({
        name: patch.name ?? stored.name,
        permissions: patch.permissions ?? decodePermissions(stored.permissions)
      }, id)
      db.prepare('UPDATE access_role SET name = ?, permissions = ? WHERE id = ?')
        .run(role.name, JSON.stringify(role.permissions), id)
      return { id, ...role, builtin: false }
    },

    removeRole(id: string): void {
      requireCustomRole(id)
      if (db.prepare('SELECT 1 FROM "user" WHERE access_role_id = ? LIMIT 1').get(id)) {
        throw new BizError('VALIDATION', '请先为使用此角色的操作员分配其他角色')
      }
      db.prepare('DELETE FROM access_role WHERE id = ?').run(id)
    },

    sessionById(id: number): SessionUser | null {
      const row = db.prepare('SELECT * FROM "user" WHERE id = ?').get(id) as UserRow | undefined
      return row ? toSession(row) : null
    },

    setupStatus,
    setupAdmin,
    /** 登录校验；成功返回会话用户（不含哈希），失败（不存在/密码错/已停用）返回 null。 */
    verify(username: string, password: string): SessionUser | null {
      const row = db.prepare(`SELECT * FROM "user" WHERE username = ?`).get(username) as
        | UserRow
        | undefined
      if (!row) return null
      if (row.disabled || (row.username === "admin" && password === "admin123")) return null
      if (!checkPassword(password, row.password_hash)) return null
      return toSession(row)
    },

    can(user: SessionUser | null, permission: PermissionKey): boolean {
      if (!user) return false
      return roleHas(user.role, permission, user.permissions)
    },

    create(input: { username: string; password: string; role: string }): SafeUser {
      const username = String(input.username ?? '').trim()
      const password = String(input.password ?? '')
      const [role, accessRole] = roleColumns(input.role)
      if (!username) throw new BizError('VALIDATION', '用户名不能为空')
      if (!password) throw new BizError('VALIDATION', '密码不能为空')
      const dup = db.prepare(`SELECT id FROM "user" WHERE username = ?`).get(username)
      if (dup) throw new BizError('DUP_CODE', `用户名「${username}」已存在`)
      const info = db
        .prepare(`INSERT INTO "user" (username, password_hash, role, access_role_id) VALUES (?, ?, ?, ?)`)
        .run(username, hashPassword(password), role, accessRole)
      const row = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(info.lastInsertRowid) as UserRow
      return toSafe(row)
    },

    update(id: number, patch: { password?: string; role?: string; disabled?: number | boolean }): SafeUser {
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
        const [role, accessRole] = roleColumns(patch.role)
        sets.push('role = ?', 'access_role_id = ?')
        vals.push(role, accessRole)
      }
      if (patch.disabled !== undefined) {
        const disabled = patch.disabled ? 1 : 0
        if (disabled === 1 && row.role === 'admin' && row.disabled === 0 && countActiveAdmins(id) === 0) {
          throw new BizError('VALIDATION', '至少保留一个管理员')
        }
        sets.push('disabled = ?')
        vals.push(disabled)
      }
      if (patch.role !== undefined && patch.role !== 'admin' && row.role === 'admin' && row.disabled === 0 && countActiveAdmins(id) === 0) {
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
      if (row.role === 'admin' && row.disabled === 0 && countActiveAdmins(id) === 0) {
        throw new BizError('VALIDATION', '至少保留一个管理员')
      }
      db.prepare(`DELETE FROM "user" WHERE id = ?`).run(id)
    }
  }
}

export type UserService = ReturnType<typeof createUserService>
