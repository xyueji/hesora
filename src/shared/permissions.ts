// 权限常量与角色预设（主进程与渲染进程共用）
export type PermissionKey =
  | 'product.view' | 'product.edit'
  | 'customer.view' | 'customer.edit'
  | 'supplier.view' | 'supplier.edit'
  | 'warehouse.view' | 'warehouse.edit'
  | 'fund.view' | 'fund.edit'
  | 'inventory.view' | 'inventory.adjust' | 'inventory.assemble'
  | 'doc.purchase' | 'doc.sale' | 'doc.retail' | 'doc.return' | 'doc.payment' | 'doc.viewAll'
  | 'report.arrears' | 'report.dashboard' | 'report.docSearch' | 'report.stock'
  | 'data.import' | 'data.export' | 'data.backup' | 'data.sync'
  | 'opening.edit'
  | 'system.setting' | 'system.user'

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
  'inventory.view': '查看库存',
  'inventory.adjust': '库存调整（调拨/盘点）',
  'inventory.assemble': '组装拆卸',
  'doc.purchase': '采购单据',
  'doc.sale': '销售单据',
  'doc.retail': '零售单据',
  'doc.return': '退货单据',
  'doc.payment': '收付款单据',
  'doc.viewAll': '单据查询',
  'report.arrears': '应收应付报表',
  'report.dashboard': '首页看板',
  'report.docSearch': '单据搜索',
  'report.stock': '库存报表',
  'data.import': '数据导入',
  'data.export': '数据导出',
  'data.backup': '备份恢复',
  'data.sync': '云盘同步',
  'opening.edit': '期初建账',
  'system.setting': '系统设置',
  'system.user': '用户管理'
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[]

// 收银员：看板 + 开单（零售/销售/退货/收付款）+ 基础查看
export const CASHIER_PRESET: PermissionKey[] = [
  'report.dashboard',
  'product.view',
  'customer.view',
  'customer.edit',
  'inventory.view',
  'report.stock',
  'doc.sale',
  'doc.retail',
  'doc.return',
  'doc.payment',
  'doc.viewAll',
  'report.docSearch'
]

export const ROLE_PRESETS: Record<'admin' | 'cashier', PermissionKey[]> = {
  admin: ALL_PERMISSIONS,
  cashier: CASHIER_PRESET
}

export function roleHas(role: 'admin' | 'cashier', perm: PermissionKey): boolean {
  if (role === 'admin') return true
  return ROLE_PRESETS.cashier.includes(perm)
}
