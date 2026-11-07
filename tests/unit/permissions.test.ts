import { describe, it, expect } from 'vitest'
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  isPermissionKey,
  roleDisplayName,
  roleHas
} from '../../src/shared/permissions'

describe('shared/permissions', () => {
  it('every permission key has a Chinese label and appears in exactly one group', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(PERMISSIONS[key], `缺少标签: ${key}`).toBeTruthy()
    }
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions)
    expect(new Set(grouped).size, '权限点重复出现在多个分组').toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('admin holds every permission including admin-only ones', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(roleHas('admin', key), key).toBe(true)
    }
  })

  it('cashier preset grants its listed permissions and nothing else', () => {
    expect(roleHas('cashier', 'doc.sale')).toBe(true)
    expect(roleHas('cashier', 'inventory.adjust')).toBe(false)
    expect(roleHas('cashier', 'system.user')).toBe(false)
  })

  it('custom role uses its own permission list and never admin-only grants', () => {
    const perms = ['inventory.view', 'inventory.adjust'] as const
    expect(roleHas('role-uuid', 'inventory.adjust', perms)).toBe(true)
    expect(roleHas('role-uuid', 'data.export', perms)).toBe(false)
    expect(roleHas('role-uuid', 'inventory.adjust')).toBe(false)
    for (const key of ADMIN_ONLY_PERMISSIONS) {
      expect(roleHas('role-uuid', key, [key])).toBe(false)
    }
  })

  it('rejects unknown permission keys', () => {
    expect(isPermissionKey('not.a.permission')).toBe(false)
    expect(isPermissionKey('doc.sale')).toBe(true)
    expect(roleHas('admin', 'not.a.permission' as never)).toBe(false)
  })

  it('roleDisplayName prefers the custom role name', () => {
    expect(roleDisplayName({ role: 'admin' })).toBe('管理员')
    expect(roleDisplayName({ role: 'cashier' })).toBe('收银员')
    expect(roleDisplayName({ role: 'uuid', roleName: '仓库主管' })).toBe('仓库主管')
    expect(roleDisplayName(null)).toBe('')
  })
})
