import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import type { Database } from 'better-sqlite3'
import { createOpeningService } from '../../src/main/services/opening/opening.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createRetailService } from '../../src/main/services/retail/retail.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createTransferService } from '../../src/main/services/transfer/transfer.service'
import { createStocktakeService } from '../../src/main/services/stocktake/stocktake.service'
import { createAssembleService } from '../../src/main/services/assemble/assemble.service'
import { createInventoryService } from '../../src/main/services/inventory/inventory.service'
import { createArrearsService } from '../../src/main/services/stats/arrears.service'
import { createProductService } from '../../src/main/services/product/product.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createSupplierService } from '../../src/main/services/supplier/supplier.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import type { DB } from '../../src/main/services/doc/doc.service'

function setup() {
  const db = openMemDb() as DB
  const opening = createOpeningService(db)
  const purchase = createPurchaseService(db)
  const sale = createSaleService(db)
  const retail = createRetailService(db)
  const payment = createPaymentService(db)
  const transfer = createTransferService(db)
  const stocktake = createStocktakeService(db)
  const assemble = createAssembleService(db)
  const inventory = createInventoryService(db)
  const arrears = createArrearsService(db)
  const productService = createProductService(db)
  const warehouseService = createWarehouseService(db)
  const customerService = createCustomerService(db)
  const supplierService = createSupplierService(db)
  const fundService = createFundService(db)

  const main = warehouseService.create({ name: '主仓', is_default: true })
  const sub = warehouseService.create({ name: '副仓', is_default: false })
  // 微信账户必须先建：purchase_return / sale_return 的 fund_flow 硬编码 account_id = 1
  const wechat = fundService.create({ name: '微信', type: 'wechat' })
  const productA = productService.create({
    code: 'A',
    name: '标准商品A',
    base_unit: '个',
    retail_price: 3,
    trade_price: 2.5,
    purchase_price: 2,
    tracking_type: 'none'
  })
  const productB = productService.create({
    code: 'B',
    name: '标准商品B',
    base_unit: '个',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    tracking_type: 'none'
  })
  const comboC = productService.create({
    code: 'C',
    name: '组合商品C',
    base_unit: '套',
    retail_price: 0,
    trade_price: 0,
    purchase_price: 0,
    tracking_type: 'none',
    kind: 'combo',
    bom: [
      { product_id: productA, qty: 2 },
      { product_id: productB, qty: 1 }
    ]
  })
  const zhangsan = customerService.create({ code: 'C001', name: '张三', opening_receivable: 0 })
  const laowang = supplierService.create({ code: 'S001', name: '老王', opening_payable: 0 })

  function stock(productId: number, warehouseId: number): { qty: number; moving_cost: number } {
    const rows = inventory.getByProduct(productId, warehouseId)
    return rows[0] ?? { qty: 0, moving_cost: 0 }
  }
  function flowTotals(): { in: number; out: number } {
    const rows = db.prepare('SELECT direction, amount FROM fund_flow').all() as {
      direction: string
      amount: number
    }[]
    return rows.reduce(
      (acc, r) => {
        if (r.direction === 'in') acc.in += r.amount
        else acc.out += r.amount
        return acc
      },
      { in: 0, out: 0 }
    )
  }

  return {
    db: db as Database,
    opening,
    purchase,
    sale,
    retail,
    payment,
    transfer,
    stocktake,
    assemble,
    inventory,
    arrears,
    main,
    sub,
    wechat,
    productA,
    productB,
    comboC,
    zhangsan,
    laowang,
    stock,
    flowTotals
  }
}

describe('integration: business flow end-to-end', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('runs the full business flow from opening to returns with exact stock/cost/fund/arrears', () => {
    const { main, sub, productA, productB, comboC, zhangsan, laowang, wechat } = ctx

    // ── 1. 期初建账：A 100@2 入主仓 ─────────────────────────────
    ctx.opening.save({
      inventory: [{ product_id: productA, warehouse_id: main, qty: 100, unit_cost: 2 }],
      customers: [{ customer_id: zhangsan, receivable: 0 }],
      suppliers: [{ supplier_id: laowang, payable: 0 }]
    })
    expect(ctx.opening.getStatus().done).toBe(true)
    expect(ctx.stock(productA, main)).toMatchObject({ qty: 100, moving_cost: 2 })

    // ── 2. 采购 B 50@5（老王，挂账）──────────────────────────────
    ctx.purchase.create({
      supplier_id: laowang,
      warehouse_id: main,
      items: [{ product_id: productB, qty: 50, price: 5 }]
    })
    expect(ctx.stock(productB, main)).toMatchObject({ qty: 50, moving_cost: 5 })

    // ── 3. 销售A 20@3 给张三（挂账）────────────────────────────
    ctx.sale.create({
      customer_id: zhangsan,
      warehouse_id: main,
      items: [{ product_id: productA, qty: 20, price: 3 }]
    })
    expect(ctx.stock(productA, main).qty).toBeCloseTo(80)

    // ── 4. 零售 A 5@3（散客，微信收款）─────────────────────────
    ctx.retail.create({
      warehouse_id: main,
      account_id: wechat,
      items: [{ product_id: productA, qty: 5, price: 3 }]
    })
    expect(ctx.stock(productA, main).qty).toBeCloseTo(75)
    expect(ctx.flowTotals()).toEqual({ in: 15, out: 0 })

    // ── 5. 收款单：张三 30（微信）──────────────────────────────
    ctx.payment.createReceipt({ partner_id: zhangsan, account_id: wechat, amount: 30 })
    expect(ctx.flowTotals()).toEqual({ in: 45, out: 0 })

    // ── 6. 调拨 B 10 主仓→副仓（成本 5 随货走）──────────────────
    ctx.transfer.create({
      warehouse_id: main,
      warehouse_in_id: sub,
      items: [{ product_id: productB, qty: 10 }]
    })
    expect(ctx.stock(productB, main)).toMatchObject({ qty: 40, moving_cost: 5 })
    expect(ctx.stock(productB, sub)).toMatchObject({ qty: 10, moving_cost: 5 })

    // ── 7. 盘点 主仓 A 实盘 74（账面 75，盘亏 1）────────────────
    ctx.stocktake.create({
      warehouse_id: main,
      items: [{ product_id: productA, actual_qty: 74 }]
    })
    expect(ctx.stock(productA, main).qty).toBeCloseTo(74)

    // ── 8. 组装 C 10（耗 A 20 + B 10，均在主仓）─────────────────
    // A: 74-20=54；B 主仓: 40-10=30；C 成本 = (20*2 + 10*5)/10 = 9
    ctx.assemble.create({ warehouse_id: main, combo_id: comboC, qty: 10 })
    expect(ctx.stock(productA, main)).toMatchObject({ qty: 54, moving_cost: 2 })
    expect(ctx.stock(productB, main).qty).toBeCloseTo(30)
    expect(ctx.stock(comboC, main)).toMatchObject({ qty: 10, moving_cost: 9 })

    // ── 9. 拆卸 C 5 → A +10, B +5（子件单价 = 9/Σbom_qty = 9/3 = 3）──
    // A moving_cost = (54*2 + 10*3)/64 = 138/64 = 2.15625
    ctx.assemble.disassemble({ warehouse_id: main, combo_id: comboC, qty: 5 })
    expect(ctx.stock(comboC, main).qty).toBeCloseTo(5)
    expect(ctx.stock(productA, main).qty).toBeCloseTo(64)
    expect(ctx.stock(productA, main).moving_cost).toBeCloseTo(2.15625)
    expect(ctx.stock(productB, main).qty).toBeCloseTo(35)
    expect(ctx.stock(productB, main).moving_cost).toBeCloseTo((30 * 5 + 5 * 3) / 35)

    // ── 10. 采购退货 B 2（老王，退价 5 → 应付减 10，资金流出 10）──
    // B 主仓 35-2=33（注：退货 OUT 按当前移动加权成本 (150+15)/35=4.714… 计）
    ctx.purchase.createReturn({
      supplier_id: laowang,
      warehouse_id: main,
      items: [{ product_id: productB, qty: 2, price: 5 }]
    })
    expect(ctx.stock(productB, main).qty).toBeCloseTo(33)

    // ── 11. 销售退货 A 3（张三，退价 3 → 应收减 9，资金流入 9）────
    // 退货入库成本 = 当前 A moving_cost 2.15625（第 9 步后）
    ctx.sale.createReturn({
      customer_id: zhangsan,
      warehouse_id: main,
      items: [{ product_id: productA, qty: 3, price: 3 }]
    })
    expect(ctx.stock(productA, main).qty).toBeCloseTo(67)
    expect(ctx.stock(productA, main).moving_cost).toBeCloseTo(2.15625)

    // ── 12. 应收应付汇总 ────────────────────────────────────────
    // 张三余额 = 期初0 + 销售60 − 收款30 = 30。
    // 已知限制：销售退货单不计入应收（arrears 统计仅汇总 type='sale'），
    // 因此退货减少的 9 不从余额扣除，余额仍为 30。
    const recv = ctx.arrears.receivables().find((r) => r.partner_id === zhangsan)
    expect(recv).toMatchObject({ opening: 0, amount: 60, settled: 30, balance: 30 })
    const pay = ctx.arrears.payables().find((r) => r.partner_id === laowang)
    expect(pay).toMatchObject({ opening: 0, amount: 250, settled: 0, balance: 250 })

    // ── 13. 资金流水合计 ────────────────────────────────────────
    // 流入 = 零售15 + 收款30 + 销售退货9 = 54；流出 = 采购退货10
    expect(ctx.flowTotals()).toEqual({ in: 54, out: 10 })
  })
})
