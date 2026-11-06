import type { PermissionKey } from '../shared/permissions'

// 每个 IPC 通道所需权限；不在映射中的通道无需权限（包括 auth:* 自身）。
export const PERMISSION_MAP: Record<string, PermissionKey> = {
  'product:get': 'product.view',
  'product:query': 'product.view',
  'product:create': 'product.edit',
  'product:update': 'product.edit',
  'product:disable': 'product.edit',
  'product:enable': 'product.edit',

  'customer:get': 'customer.view',
  'customer:query': 'customer.view',
  'customer:create': 'customer.edit',
  'customer:update': 'customer.edit',
  'customer:disable': 'customer.edit',
  'customer:enable': 'customer.edit',

  'supplier:get': 'supplier.view',
  'supplier:query': 'supplier.view',
  'supplier:create': 'supplier.edit',
  'supplier:update': 'supplier.edit',
  'supplier:disable': 'supplier.edit',
  'supplier:enable': 'supplier.edit',

  'warehouse:get': 'warehouse.view',
  'warehouse:query': 'warehouse.view',
  'warehouse:create': 'warehouse.edit',
  'warehouse:update': 'warehouse.edit',
  'warehouse:set-default': 'warehouse.edit',
  'warehouse:disable': 'warehouse.edit',
  'warehouse:enable': 'warehouse.edit',

  'fund:get': 'fund.view',
  'fund:query': 'fund.view',
  'fund:create': 'fund.edit',
  'fund:update': 'fund.edit',
  'fund:disable': 'fund.edit',
  'fund:enable': 'fund.edit',

  'inventory:queryStock': 'inventory.view',
  'transfer:create': 'inventory.adjust',
  'transfer:getDetail': 'inventory.adjust',
  'transfer:query': 'inventory.adjust',
  'stocktake:getSheet': 'inventory.adjust',
  'stocktake:create': 'inventory.adjust',
  'stocktake:getDetail': 'inventory.adjust',
  'stocktake:query': 'inventory.adjust',
  'assemble:create': 'inventory.assemble',
  'assemble:disassemble': 'inventory.assemble',
  'assemble:getDetail': 'inventory.assemble',
  'assemble:getDisassembleDetail': 'inventory.assemble',
  'assemble:query': 'inventory.assemble',

  'purchase:create': 'doc.purchase',
  'purchase:createReturn': 'doc.return',
  'purchase:getDetail': 'doc.purchase',
  'purchase:query': 'doc.purchase',

  'sale:create': 'doc.sale',
  'sale:createReturn': 'doc.return',
  'sale:getDetail': 'doc.sale',
  'sale:query': 'doc.sale',

  'retail:create': 'doc.retail',
  'retail:getDetail': 'doc.retail',
  'retail:query': 'doc.retail',

  'doc:query': 'doc.viewAll',
  'doc:detail': 'doc.viewAll',

  'payment:createReceipt': 'doc.payment',
  'payment:createPayment': 'doc.payment',
  'payment:getReceiptDetail': 'doc.payment',
  'payment:getPaymentDetail': 'doc.payment',
  'payment:queryReceipt': 'doc.payment',
  'payment:queryPayment': 'doc.payment',

  'stats:receivables': 'report.arrears',
  'stats:payables': 'report.arrears',
  'stats:summary': 'report.arrears',
  'dashboard:summary': 'report.dashboard',
  'dashboard:trend': 'report.dashboard',

  'opening:save': 'opening.edit',
  'opening:getStatus': 'opening.edit',

  'csv:export': 'data.export',
  'csv:importProducts': 'data.import',
  'csv:importOpeningStock': 'data.import',

  'backup:now': 'data.backup',
  'backup:pickDir': 'data.backup',
  'backup:list': 'data.backup',
  'backup:restore': 'data.backup',
  'sync:getConfig': 'data.sync',
  'sync:saveConfig': 'data.sync',
  'sync:now': 'data.sync',
  'sync:download': 'data.sync',
  'sync:restoreFromCloud': 'data.sync',

  'setting:get': 'system.setting',
  'setting:set': 'system.setting',
  'setting:getAll': 'system.setting',
  'setting:remove': 'system.setting',

  'user:query': 'system.user',
  'user:get': 'system.user',
  'user:create': 'system.user',
  'user:update': 'system.user',
  'user:remove': 'system.user'
}
