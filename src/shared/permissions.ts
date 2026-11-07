// 权限常量与角色预设（主进程与渲染进程共用）
export type PermissionKey =
  | 'product.view' | 'product.edit'
  | 'customer.view' | 'customer.edit'
  | 'supplier.view' | 'supplier.edit'
  | 'warehouse.view' | 'warehouse.edit'
  | 'fund.view' | 'fund.edit' | 'fund.ledger' | 'fund.transfer'
  | 'inventory.view' | 'inventory.adjust' | 'inventory.assemble'
  | 'doc.purchase' | 'doc.sale' | 'doc.retail' | 'doc.return' | 'doc.payment' | 'doc.viewAll'
  | 'doc.workflow' | 'doc.approve' | 'doc.print'
  | 'report.cost' | 'report.arrears' | 'report.dashboard' | 'report.docSearch' | 'report.stock' | 'report.business'
  | 'data.import' | 'data.export' | 'data.backup' | 'data.sync'
  | 'opening.edit'
  | 'system.setting' | 'system.user' | 'system.role'

export const PERMISSIONS: Record<PermissionKey, string> = {
  'product.view': '查看商品',
  'product.edit': '编辑商品',
  'customer.view': '查看客户',
  'customer.edit': '编辑客户',
  'supplier.view': '查看供应商',
  'supplier.edit': '编辑供应商',
  'warehouse.view': '查看仓库',
  'warehouse.edit': '编辑仓库',
  'fund.view': '查看资金账户',
  'fund.edit': '编辑资金账户',
  'fund.ledger': '查看资金余额与流水',
  'fund.transfer': '账户间转账',
  'inventory.view': '查看库存',
  'inventory.adjust': '库存调整（调拨/盘点）',
  'inventory.assemble': '组装拆卸',
  'doc.purchase': '采购单据',
  'doc.sale': '销售单据',
  'doc.retail': '零售单据',
  'doc.return': '退货单据',
  'doc.payment': '收付款单据',
  'doc.viewAll': '单据查询',
  'doc.workflow': '管理报价、订单与草稿',
  'doc.approve': '审核与过账',
  'doc.print': '打印单据',
  'report.cost': '查看成本与利润',
  'report.arrears': '应收应付报表',
  'report.dashboard': '首页看板',
  'report.docSearch': '单据搜索',
  'report.stock': '库存报表',
  'report.business': '经营报表',
  'data.import': '数据导入',
  'data.export': '数据导出',
  'data.backup': '备份恢复',
  'data.sync': '云盘同步',
  'opening.edit': '期初建账',
  'system.setting': '系统设置',
  'system.user': '用户管理',
  'system.role': '角色权限管理'
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[]

// 收银员：开单、打印及选择开单所需的基础档案。
export const CASHIER_PRESET: PermissionKey[] = [
  'report.dashboard',
  'product.view',
  'customer.view',
  'customer.edit',
  'warehouse.view',
  'fund.view',
  'inventory.view',
  'report.stock',
  'doc.sale',
  'doc.print',
  'doc.workflow',
  'doc.retail',
  'doc.viewAll',
  'report.docSearch'
]

export const ROLE_PRESETS: Record<'admin' | 'cashier', PermissionKey[]> = {
  admin: ALL_PERMISSIONS,
  cashier: CASHIER_PRESET
}

export const ADMIN_ONLY_PERMISSIONS: readonly PermissionKey[] = ['system.user', 'system.role']

export interface AccessRole {
  id: string
  name: string
  permissions: PermissionKey[]
  builtin: boolean
}

export interface RoleInput {
  name: string
  permissions: PermissionKey[]
}

export interface SessionUser {
  id: number
  username: string
  role: string
  roleName?: string
  permissions?: PermissionKey[]
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value)
}

export function roleHas(role: string, perm: PermissionKey, permissions?: readonly PermissionKey[]): boolean {
  if (!isPermissionKey(perm)) return false
  if (role === 'admin') return true
  if (ADMIN_ONLY_PERMISSIONS.includes(perm)) return false
  if (role === 'cashier') return CASHIER_PRESET.includes(perm)
  return permissions?.includes(perm) ?? false
}
