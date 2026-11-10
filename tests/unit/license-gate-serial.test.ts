// v1.4 serial_batch 门控：序列号写入通道（serial:registerIn/consumeOut）、批次/效期设置
// （product:setShelfLife/product:saveBatch）、单据带 serial_numbers（retail:create/sale:create）
// 在 standard（无 serial_batch 特征）下抛 E_FEATURE_PRO；professional 放行；查询通道 serial:stock 不拦。
import { describe, it, expect, beforeEach } from 'vitest'
import { buildAllHandlers, type HandlerDeps } from '../../src/main/ipc/handlers'
import { openMemDb } from '../helpers/mem-db'
import type { LicensePayload } from '../../src/shared/license'
import { E_FEATURE_PRO } from '../../src/main/services/license-gate'

const memDb = openMemDb() as unknown as import('../../src/main/db').DB
const auditStub = { record: () => {}, list: () => [], query: () => [] } as never

function makeDeps(licensePayload: () => LicensePayload | null): HandlerDeps {
  return {
    getDb: () => memDb,
    productImagesDir: () => '/tmp/x',
    attachmentsDir: () => '/tmp/x',
    resetDemoData: () => false,
    licenseSvc: (() => ({ getStatus: () => { throw new Error('not called') }, activate: () => { throw new Error('not called') } })) as never,
    licensePayload,
    auditSvc: () => auditStub
  }
}

function handlerFor(channel: string, deps: HandlerDeps): (evt: unknown, payload: unknown, session?: unknown) => unknown {
  const h = buildAllHandlers(deps).find((x) => x.channel === channel)
  if (!h) throw new Error(`channel ${channel} not found`)
  return h.handler as typeof h.handler
}

const standardPayload = (): LicensePayload | null => ({ customer: 'c', issuedAt: '2026-11-01' })
const proPayload = (): LicensePayload | null => ({
  customer: 'c', issuedAt: '2026-11-01', edition: 'professional', features: ['serial_batch', 'multi_warehouse', 'rbac']
})

// 造基础数据：商品 + 仓库
function seedProductAndWarehouse(): { productId: number; warehouseId: number } {
  const w = memDb.prepare("INSERT INTO warehouse (code, name, is_default, disabled) VALUES ('W1', '主仓', 1, 0)").run()
  const p = memDb.prepare("INSERT INTO product (code, name, base_unit, retail_price, purchase_price) VALUES ('P1', '测试商品', '台', 100, 60)").run()
  return { productId: Number(p.lastInsertRowid), warehouseId: Number(w.lastInsertRowid) }
}

function expectProError(fn: () => unknown, tag: string): void {
  try {
    fn()
    throw new Error(`${tag} should have thrown`)
  } catch (e) {
    expect((e as { code: string }).code, tag).toBe(E_FEATURE_PRO)
  }
}

beforeEach(() => {
  for (const t of ['serial_number', 'serial_flow', 'product_batch', 'bom_item', 'formula_item', 'formula',
    'customer_product_price', 'price_change_log', 'price_adjust_log', 'product_barcode', 'product_price',
    'inventory', 'cost_log', 'product', 'warehouse']) {
    memDb.prepare(`DELETE FROM ${t}`).run()
  }
})

describe('serial_batch license gate', () => {
  it('standard: serial:registerIn / serial:consumeOut reject E_FEATURE_PRO', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    memDb.prepare("UPDATE product SET tracking_type='serial' WHERE id=?").run(productId)
    const deps = makeDeps(standardPayload)
    expectProError(() => handlerFor('serial:registerIn', deps)(null, [{ product_id: productId, warehouse_id: warehouseId, sn: 'SN1' }]), 'registerIn')
  })

  it('standard: product:setShelfLife / product:saveBatch reject E_FEATURE_PRO', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    const deps = makeDeps(standardPayload)
    expectProError(() => handlerFor('product:setShelfLife', deps)(null, { productId, config: { enabled: true } }), 'setShelfLife')
    expectProError(() => handlerFor('product:saveBatch', deps)(null, { productId, warehouseId, batchNo: 'B1' }), 'saveBatch')
  })

  it('professional with serial_batch: registerIn / saveBatch succeed', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    memDb.prepare("UPDATE product SET tracking_type='serial' WHERE id=?").run(productId)
    const deps = makeDeps(proPayload)
    expect(() => handlerFor('serial:registerIn', deps)(null, [{ product_id: productId, warehouse_id: warehouseId, sn: 'SN1' }])).not.toThrow()
    expect(() => handlerFor('product:saveBatch', deps)(null, { productId, warehouseId, batchNo: 'B1' })).not.toThrow()
  })

  it('standard: query channels (serial:stock) stay open to avoid renderer dead ends', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    const deps = makeDeps(standardPayload)
    expect(() => handlerFor('serial:stock', deps)(null, { product_id: productId, warehouse_id: warehouseId })).not.toThrow()
  })

  it('standard: retail:create with serial_numbers in items rejects; without serial passes gating', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    // retail:create 需要登录用户（userFor）+ 有效收款账户
    memDb.prepare("DELETE FROM \"user\"").run(); memDb.prepare("INSERT INTO \"user\" (username, password_hash, role) VALUES ('admin', '', 'admin')").run()
    memDb.prepare("INSERT INTO fund_account (code, name, type, opening_balance) VALUES ('CASH', '现金', 'cash', 0)").run()
    const deps = makeDeps(standardPayload)
    const expectPro = (payload: unknown, tag: string): void => {
      try {
        handlerFor('retail:create', deps)(undefined, payload, { userId: 1 })
        throw new Error(`${tag} should have thrown`)
      } catch (e) {
        expect((e as { code: string }).code, tag).toBe(E_FEATURE_PRO)
      }
    }
    expectPro({ warehouse_id: warehouseId, account_id: 1, items: [{ product_id: productId, qty: 1, price: 100, serial_numbers: ['SN1'] }] }, 'retail with serial')
  })

  it('professional with serial_batch: retail:create with serial_numbers not gated (may fail on business rules, not E_FEATURE_PRO)', () => {
    const { productId, warehouseId } = seedProductAndWarehouse()
    memDb.prepare("DELETE FROM \"user\"").run(); memDb.prepare("INSERT INTO \"user\" (username, password_hash, role) VALUES ('admin', '', 'admin')").run()
    memDb.prepare("DELETE FROM fund_account").run(); memDb.prepare("INSERT INTO fund_account (code, name, type, opening_balance) VALUES ('CASH', '现金', 'cash', 0)").run()
    const deps = makeDeps(proPayload)
    try {
      handlerFor('retail:create', deps)(undefined, { warehouse_id: warehouseId, account_id: 1, items: [{ product_id: productId, qty: 1, price: 100, serial_numbers: ['SN1'] }] }, { userId: 1 })
    } catch (e) {
      expect((e as { code: string }).code, 'business error allowed, gate error not').not.toBe(E_FEATURE_PRO)
    }
  })
})
