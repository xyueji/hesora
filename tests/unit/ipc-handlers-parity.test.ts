import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { buildAllHandlers, type HandlerDeps } from '../../src/main/ipc/handlers'
import { openMemDb } from '../helpers/mem-db'
import type { DB } from '../../src/main/db'

// parity 测试：只断言结构（channel 名单 + handler 可调用性），不真正调用任何 handler。
// 真正的行为回归由全量既有用例保证（v1.3 Task 2）。

// 从 index.ts 抽出的全部通道（print:* / csv:* / backup:* / sync:* / update:* 留在 index.ts 本地，不在其中）
const EXPECTED_CHANNELS: string[] = [
  // license/trial
  'license:check', 'license:activate', 'license:activateOnline', 'trial:check', 'trial:resetDemo',
  // workflow
  'workflow:list', 'workflow:save', 'workflow:approve', 'workflow:convert', 'workflow:cancel',
  // product
  'product:create', 'product:update', 'product:get', 'product:getByBarcode', 'product:query', 'product:disable', 'product:costMap', 'product:enable', 'product:bulkUpdate',
  // price levels / shelf life
  'product:priceLevels', 'product:savePriceLevels', 'product:setShelfLife', 'product:batches', 'product:saveBatch',
  // customer price
  'customerPrice:set', 'customerPrice:remove', 'customerPrice:listByCustomer', 'customerPrice:listByProduct', 'customerPrice:changeLog',
  // product attribute
  'productAttribute:list', 'productAttribute:create', 'productAttribute:update', 'productAttribute:remove',
  // customer
  'customer:create', 'customer:update', 'customer:get', 'customer:query', 'customer:disable', 'customer:enable', 'customer:detail',
  // supplier
  'supplier:create', 'supplier:update', 'supplier:get', 'supplier:query', 'supplier:disable', 'supplier:enable',
  // warehouse
  'warehouse:create', 'warehouse:update', 'warehouse:get', 'warehouse:query', 'warehouse:set-default', 'warehouse:disable', 'warehouse:enable',
  // fund / ledger
  'ledger:accounts', 'ledger:entries', 'ledger:transfer', 'fund:create', 'fund:update', 'fund:get', 'fund:query', 'fund:disable', 'fund:enable',
  // setting
  'setting:get', 'setting:set', 'setting:getAll', 'setting:remove',
  // v1.3 Task 8: LAN config
  'lan:getConfig', 'lan:setConfig',
  // category
  'category:list', 'category:create', 'category:update', 'category:remove', 'category:disable', 'category:enable',
  // formula
  'formula:list', 'formula:get', 'formula:create', 'formula:update', 'formula:remove', 'formula:disable', 'formula:enable',
  // opening
  'opening:save', 'opening:getStatus',
  // inventory
  'inventory:listCostLogs', 'inventory:queryStock',
  // stock report
  'stock:statisticsDetail', 'stock:costChanges', 'stock:flows', 'stock:warnings', 'stock:unsold', 'stock:setWarning', 'stock:setWarningsByCondition', 'stock:purchaseSuggestions', 'stock:adjustPrices',
  // serial
  'serial:registerIn', 'serial:consumeOut', 'serial:stock', 'serial:flows', 'serial:validate', 'serial:stockOf', 'serial:trace',
  // doc copy / reversal / review
  'doc:copy',
  'doc:reverse', 'doc:reversals',
  'doc:review',
  // purchase
  'purchase:create', 'purchase:createReturn', 'purchase:getDetail', 'purchase:query',
  // sale
  'sale:create', 'sale:createReturn', 'sale:getDetail', 'sale:query',
  // doc query/detail
  'doc:query', 'doc:detail',
  // retail
  'retail:create', 'retail:hold', 'retail:listHeld', 'retail:discardHeld', 'retail:getDetail', 'retail:query',
  // payment
  'payment:openDocuments', 'payment:create', 'payment:query', 'payment:getDetail', 'payment:createReceipt', 'payment:createPayment', 'payment:getReceiptDetail', 'payment:getPaymentDetail', 'payment:queryReceipt', 'payment:queryPayment',
  // stats
  'stats:statement', 'stats:partnerAging', 'stats:receivables', 'stats:payables', 'stats:summary', 'stats:aging', 'stats:report', 'stats:operatorPerformance', 'stats:fundSummaryByCategory', 'stats:monthlyStock', 'stats:hotSale',
  'stats:calendarSales',
  // internal use
  'internalUse:create', 'internalUse:getDetail', 'internalUse:query',
  // flow category
  'flowCategory:list', 'flowCategory:create', 'flowCategory:update', 'flowCategory:remove', 'flowCategory:disable', 'flowCategory:enable',
  // product image
  'productImage:save', 'productImage:remove', 'productImage:list', 'productImage:read',
  // attachment
  'attachment:save', 'attachment:list', 'attachment:remove', 'attachment:read',
  // dashboard
  'dashboard:summary', 'dashboard:trend', 'dashboard:todayBrief', 'dashboard:reminders',
  // transfer
  'transfer:create', 'transfer:getDetail', 'transfer:query',
  // stocktake
  'stocktake:getSheet', 'stocktake:create', 'stocktake:review', 'stocktake:getDetail', 'stocktake:query', 'stocktake:importSheet',
  // assemble
  'assemble:create', 'assemble:disassemble', 'assemble:getDetail', 'assemble:getDisassembleDetail', 'assemble:query',
  // print template
  'printTemplate:list', 'printTemplate:save', 'printTemplate:remove', 'printTemplate:setDefault',
  // audit
  'audit:list', 'audit:query',
  // auth / user / role
  'auth:setupStatus', 'auth:setup', 'auth:login', 'auth:current', 'auth:logout', 'user:query', 'user:get', 'user:create', 'user:update', 'user:remove', 'role:list', 'role:create', 'role:update', 'role:remove'
]

const LOCAL_CHANNELS = [
  'print:receipt', 'print:a4pdf',
  'csv:export', 'csv:importProducts', 'csv:previewProducts', 'csv:importOpeningStock', 'csv:previewOpeningStock',
  'backup:now', 'backup:pickDir', 'backup:list', 'backup:restore',
  'sync:getConfig', 'sync:saveConfig', 'sync:now', 'sync:download', 'sync:checkTargets', 'sync:cancelRestore', 'sync:restoreFromCloud'
]

// buildAllHandlers 在构建期会急切实例化全部服务（与原 index.ts initialize 行为一致），
// 因此这里传入 openMemDb 内存库与临时目录，而不是纯桩。
const stubAudit = {
  record: () => {},
  list: () => {
    throw new Error('not called')
  },
  query: () => {
    throw new Error('not called')
  }
} as unknown as ReturnType<HandlerDeps['auditSvc']>
const stubLicense = new Proxy(
  {},
  {
    get() {
      return () => {
        throw new Error('not called')
      }
    }
  }
) as unknown as ReturnType<HandlerDeps['licenseSvc']>

const memDb = openMemDb() as unknown as DB
const tmpRoot = mkdtempSync(join(tmpdir(), 'ipc-parity-'))
const stubDeps: HandlerDeps = {
  getDb: () => memDb,
  productImagesDir: () => join(tmpRoot, 'product-images'),
  attachmentsDir: () => join(tmpRoot, 'attachments'),
  resetDemoData: () => false,
  licenseSvc: () => stubLicense,
  licensePayload: () => null, // v1.4 门控：parity 测试不触发业务（standard null → 仅多仓第二仓起拒）
  auditSvc: () => stubAudit
}

describe('ipc handlers parity', () => {
  it('exports exactly the expected channel set (no extras, none missing)', () => {
    const handlers = buildAllHandlers(stubDeps)
    const actual = handlers.map((h) => h.channel)
    expect(actual).toEqual(EXPECTED_CHANNELS)
  })

  it('every handler is a function and channel is a non-empty string', () => {
    const handlers = buildAllHandlers(stubDeps)
    for (const { channel, handler } of handlers) {
      expect(typeof channel).toBe('string')
      expect(channel.length).toBeGreaterThan(0)
      expect(typeof handler).toBe('function')
    }
  })

  it('no electron-lifecycle channel leaked into the extracted table', () => {
    const handlers = buildAllHandlers(stubDeps)
    const actual = new Set(handlers.map((h) => h.channel))
    for (const ch of LOCAL_CHANNELS) {
      expect(actual.has(ch)).toBe(false)
    }
  })

  it('spot-checks 10 key business channels are callable handlers', () => {
    const handlers = new Map(buildAllHandlers(stubDeps).map((h) => [h.channel, h.handler]))
    // 注：doc:list / inventory:transfer / reversal:reverse 是规划文档中的旧称，
    // 实际通道名为 doc:query / transfer:create / doc:reverse，此处按实际名单抽查。
    const actualKeys = [
      'sale:create', 'customer:create', 'product:create', 'doc:query', 'license:activate',
      'stocktake:create', 'payment:create', 'transfer:create', 'doc:reverse', 'doc:detail'
    ]
    for (const ch of actualKeys) {
      const h = handlers.get(ch)
      expect(h, `channel ${ch} should exist`).toBeDefined()
      expect(typeof h).toBe('function')
    }
    // 确认规划旧称确实不存在（防止误抽/漏抽混淆）
    for (const ch of ['doc:list', 'inventory:transfer', 'reversal:reverse']) {
      expect(handlers.has(ch)).toBe(false)
    }
  })
})
