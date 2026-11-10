import type { Database } from 'better-sqlite3'
import { createProductService } from '../services/product/product.service'
import { createPriceLevelService } from '../services/product/price-level.service'
import { createCustomerService } from '../services/customer/customer.service'
import { createSupplierService } from '../services/supplier/supplier.service'
import { createWarehouseService } from '../services/warehouse/warehouse.service'
import { createFundService } from '../services/fund/fund.service'
import { createOpeningService } from '../services/opening/opening.service'
import { createPurchaseService } from '../services/purchase/purchase.service'
import { createSaleService } from '../services/sale/sale.service'
import { createRetailService } from '../services/retail/retail.service'
import { createPaymentService } from '../services/payment/payment.service'
import { createWorkflowService } from '../services/workflow/workflow.service'
import { createTransferService } from '../services/transfer/transfer.service'
import { createStocktakeService } from '../services/stocktake/stocktake.service'
import { createSerialService } from '../services/inventory/serial.service'

/**
 * 演示数据种子 —— 对齐逆向参考项目 mock（zhjspace/renderer-web/mock/data.mjs）的
 * 数据形态：演示商贸有限公司、总店默认仓+副仓、12 个商品（SP1001+）、10 个客商
 * （KH/GYS 2001+）、采购/销售/零售/报价→订单→销售转单链/收付款/调拨/盘点全链路单据，
 * 金额与库存自洽（期初库存 - 销售/零售/调拨/盘亏 + 采购 = 期末账面）。
 *
 * 只在独立演示账套调用。整套数据一次提交，失败时可重试。
 */
export function seedDemoData(db: Database): boolean {
  return db.transaction(() => populateDemoData(db)).immediate()
}

/**
 * 重置演示数据：清空业务数据表后重灌初始演示态。
 * 保留：app_setting 中的 license.*（试用计时/激活码）、guide.*、用户与角色表、
 * platform_log（审计红线：危险操作日志不得清除）。
 * 试用计时不受演示数据重置影响（first_run_at/license.start 落盘后不回退）。
 */
const DEMO_TABLES: readonly string[] = [
  'serial_flow', 'serial_number', 'doc_workflow_event', 'doc_workflow', 'doc_item', 'doc',
  'payment_allocation', 'fund_transfer', 'fund_flow', 'income_category',
  'retail_held', 'cost_log', 'inventory', 'price_adjust_log', 'price_change_log',
  'customer_product_price', 'product_price', 'product_unit', 'product_barcode',
  'product_batch', 'product_attribute', 'bom_item', 'formula_item', 'formula',
  'flow_category', 'attachment', 'print_template',
  'product', 'customer', 'supplier', 'warehouse', 'fund_account'
]

// app_setting 中保留业务侧键（期初建账标记随演示重置，引导与授权键保留）
const KEEP_SETTING_PREFIXES: readonly string[] = ['license.', 'guide.', 'sync.', 'backup.']
const RESET_SETTINGS: readonly string[] = ['opening.done']

export function resetDemoData(db: Database): boolean {
  return db.transaction(() => {
    for (const table of DEMO_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    for (const key of RESET_SETTINGS) {
      db.prepare('DELETE FROM app_setting WHERE key = ?').run(key)
    }
    // 清理游离设置：不属于保留前缀且非用户/角色的 app_setting 全清，保证种子自洽
    const keys = (db.prepare('SELECT key FROM app_setting').all() as Array<{ key: string }>).map((r) => r.key)
    for (const key of keys) {
      if (!KEEP_SETTING_PREFIXES.some((p) => key.startsWith(p))) {
        db.prepare('DELETE FROM app_setting WHERE key = ?').run(key)
      }
    }
    return populateDemoData(db)
  }).immediate()
}

function populateDemoData(db: Database): boolean {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM product').get() as { c: number }).c
  if (count > 0) return false

  const products = createProductService(db)
  const priceLevels = createPriceLevelService(db)
  const customers = createCustomerService(db)
  const suppliers = createSupplierService(db)
  const warehouses = createWarehouseService(db)
  const funds = createFundService(db)
  const opening = createOpeningService(db)
  const purchase = createPurchaseService(db)
  const sale = createSaleService(db)
  const retail = createRetailService(db)
  const payment = createPaymentService(db)
  const workflow = createWorkflowService(db)
  const transfer = createTransferService(db)
  const stocktake = createStocktakeService(db)
  const serials = createSerialService(db)

  const today = new Date()
  const d = (offset: number): string => {
    const t = new Date(today)
    t.setDate(t.getDate() - offset)
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }

  // ---------- 仓库 / 资金账户 ----------
  const mainWh = warehouses.create({ name: '总店默认仓', address: '演示商贸有限公司 总店', is_default: true })
  const subWh = warehouses.create({ name: '副仓', address: '演示商贸有限公司 分店', is_default: false })
  const cashAcc = funds.create({ code: 'CASH01', name: '现金', type: 'cash', opening_balance: 2000 })
  const wechatAcc = funds.create({ code: 'WX01', name: '微信收款', type: 'wechat', opening_balance: 5000 })
  const bankAcc = funds.create({ code: 'BANK01', name: '对公账户', type: 'bank', opening_balance: 30000 })

  // ---------- 客户（价格等级覆盖 VIP / 批发 / 零售） ----------
  const customerDefs: Array<{ code: string; name: string; price_level?: string; opening_receivable: number; contact: string; phone: string }> = [
    { code: 'KH2001', name: '阳光超市', price_level: 'VIP', opening_receivable: 120, contact: '王经理', phone: '13800000001' },
    { code: 'KH2002', name: '惠民便利店', price_level: '批发', opening_receivable: 140, contact: '李店长', phone: '13800000002' },
    { code: 'KH2003', name: '好邻居百货', price_level: 'VIP', opening_receivable: 160, contact: '张老板', phone: '13800000003' },
    { code: 'KH2004', name: '天天批发部', price_level: '批发', opening_receivable: 180, contact: '刘经理', phone: '13800000004' },
    { code: 'KH2005', name: '校园小卖部', opening_receivable: 200, contact: '陈老师', phone: '13800000005' },
    { code: 'KH2006', name: '社区团购点', price_level: 'VIP', opening_receivable: 220, contact: '赵团长', phone: '13800000006' },
    { code: 'KH2007', name: '城东超市', price_level: '批发', opening_receivable: 240, contact: '孙店长', phone: '13800000007' },
    { code: 'KH2008', name: '开发区食堂', opening_receivable: 260, contact: '周主管', phone: '13800000008' },
    { code: 'KH2009', name: '老城杂货铺', opening_receivable: 280, contact: '吴老板', phone: '13800000009' },
    { code: 'KH2010', name: '新区便利站', price_level: '批发', opening_receivable: 300, contact: '郑经理', phone: '13800000010' }
  ]
  const customerIds = customerDefs.map((c) => customers.create(c))

  // ---------- 供应商 ----------
  const supplierDefs = [
    { code: 'GYS2001', name: '康师傅食品批发部', opening_payable: 150, contact: '钱经理', phone: '13900000001' },
    { code: 'GYS2002', name: '农夫山泉办事处', opening_payable: 200, contact: '冯主管', phone: '13900000002' },
    { code: 'GYS2003', name: '得力文具代理', opening_payable: 250, contact: '褚经理', phone: '13900000003' },
    { code: 'GYS2004', name: '恒安纸业配送中心', opening_payable: 300, contact: '卫经理', phone: '13900000004' },
    { code: 'GYS2005', name: '可口可乐营业所', opening_payable: 350, contact: '蒋代表', phone: '13900000005' },
    { code: 'GYS2006', name: '文具百货总仓', opening_payable: 400, contact: '沈经理', phone: '13900000006' }
  ]
  const supplierIds = supplierDefs.map((s) => suppliers.create(s))

  // ---------- 商品（对齐 mock GOODS：6 类 12 个 SKU） ----------
  // 8 个标准商品 + SP1009/SP1010 批次+保质期 + SP1012 组合商品；金额与 mock 进价/售价梯度一致。
  const goods = [
    { code: 'SP1001', name: '康师傅红烧牛肉面', spec: '五连包', category: '食品饮料', base_unit: '包', retail_price: 12.5, trade_price: 11, purchase_price: 9.5, min_stock: 20 },
    { code: 'SP1002', name: '康师傅香辣牛肉面', spec: '五连包', category: '食品饮料', base_unit: '包', retail_price: 12.5, trade_price: 11, purchase_price: 9.5, min_stock: 20 },
    { code: 'SP1003', name: '农夫山泉饮用水', spec: '550ml', category: '食品饮料', base_unit: '瓶', retail_price: 2, trade_price: 1.6, purchase_price: 1.2, min_stock: 48 },
    { code: 'SP1004', name: '农夫山泉饮用天然水', spec: '1.5L', category: '食品饮料', base_unit: '瓶', retail_price: 4, trade_price: 3.2, purchase_price: 2.5, min_stock: 24 },
    { code: 'SP1005', name: '中华铅笔', spec: 'HB 六角杆', category: '文具办公', base_unit: '支', retail_price: 1.5, trade_price: 1.1, purchase_price: 0.8, min_stock: 100 },
    { code: 'SP1006', name: '中华铅笔', spec: '2H 六角杆', category: '文具办公', base_unit: '支', retail_price: 1.5, trade_price: 1.1, purchase_price: 0.8, min_stock: 100 },
    { code: 'SP1007', name: '得力A4复印纸', spec: '70g 500张', category: '文具办公', base_unit: '包', retail_price: 18, trade_price: 16, purchase_price: 13.5, min_stock: 10 },
    { code: 'SP1008', name: '得力A4复印纸', spec: '80g 500张', category: '文具办公', base_unit: '包', retail_price: 21, trade_price: 18.5, purchase_price: 15.5, min_stock: 10 },
    { code: 'SP1009', name: '心相印抽纸', spec: '3层100抽', category: '日用百货', base_unit: '包', retail_price: 4.5, trade_price: 3.8, purchase_price: 3, min_stock: 40, shelf_life_days: 730, shelf_life_warn_days: 90 },
    { code: 'SP1010', name: '心相印卷纸', spec: '4层140g', category: '日用百货', base_unit: '卷', retail_price: 5, trade_price: 4.2, purchase_price: 3.3, min_stock: 40, shelf_life_days: 730, shelf_life_warn_days: 90 },
    { code: 'SP1011', name: '可口可乐', spec: '330ml', category: '食品饮料', base_unit: '听', retail_price: 3, trade_price: 2.5, purchase_price: 2, min_stock: 36 }
  ]
  const productIds: number[] = goods.map((g) => {
    const { shelf_life_days, shelf_life_warn_days, ...rest } = g
    return products.create({ ...rest, tracking_type: 'none', shelf_life_days, shelf_life_warn_days })
  })
  // 组合商品 SP1012：1×SP1001 + 2×SP1003（BOM 需要子件 id，故在标准商品之后创建）
  productIds.push(products.create({
    code: 'SP1012', name: '中秋礼盒套装', spec: '面+饮料组合', category: '组合商品',
    base_unit: '套', retail_price: 25, trade_price: 22, purchase_price: 0, min_stock: 10,
    tracking_type: 'none', kind: 'combo',
    bom: [
      { product_id: productIds[0]!, qty: 1 },
      { product_id: productIds[2]!, qty: 2 }
    ]
  }))
  // 序列号演示商品：SP1005 中华铅笔（HB）改为 serial 跟踪，用于序列号台账演示。
  // 注意：该商品期初/销售按普通库存进出，序列号台账独立登记演示数据。
  products.update(productIds[4]!, { code: 'SP1005', name: '中华铅笔（序列号管理）', spec: 'HB 六角杆', category: '文具办公', base_unit: '支', retail_price: 1.5, trade_price: 1.1, purchase_price: 0.8, min_stock: 100, tracking_type: 'serial' })

  // ---------- 价格等级（对齐 mock pricelevel：VIP 92 折、批发=trade_price） ----------
  for (const [i, pid] of productIds.entries()) {
    if (i > 7 && i !== 10) continue
    priceLevels.setLevels(pid, [
      { price_level: 'VIP', price: Math.round(goods[i]!.retail_price * 0.92 * 100) / 100 },
      { price_level: '批发', price: goods[i]!.trade_price }
    ])
  }

  // ---------- 期初建账（opening.done=1 后不可改，因此一次写全） ----------
  // SP1005 已改为 serial 跟踪：序列号商品不进普通期初库存（一件一码，由后面的序列号台账演示）。
  opening.save({
    inventory: [
      // 主仓期初库存（对齐 mock stock：120 - i*3；SP1005 序列号商品不进普通库存）
      ...productIds.slice(0, 11)
        .map((id, i) => ({ id, idx: i }))
        .filter(({ idx }) => idx !== 4)
        .map(({ id, idx }) => ({ product_id: id, warehouse_id: mainWh, qty: 120 - idx * 3, unit_cost: goods[idx]!.purchase_price })),
      // 副仓少量库存
      ...productIds.slice(0, 4).map((id, i) => ({ product_id: id, warehouse_id: subWh, qty: 24 - i * 2, unit_cost: goods[i]!.purchase_price }))
    ],
    customers: customerDefs.map((c, i) => ({ customer_id: customerIds[i]!, receivable: c.opening_receivable })),
    suppliers: supplierDefs.map((s, i) => ({ supplier_id: supplierIds[i]!, payable: s.opening_payable }))
  })

  // ---------- 业务单据 ----------
  const item = (idx: number, qty: number, price?: number) => ({
    product_id: productIds[idx]!,
    qty,
    price: price ?? goods[idx]!.retail_price
  })

  // 采购 2 单（含批次商品批次入库）
  purchase.create({
    supplier_id: supplierIds[0]!, warehouse_id: mainWh, date: d(6), remark: '食品补货',
    items: [item(0, 50, 9.5), item(1, 50, 9.5)]
  })
  purchase.create({
    supplier_id: supplierIds[1]!, warehouse_id: mainWh, date: d(5), remark: '饮料进货',
    items: [
      { product_id: productIds[2]!, qty: 100, price: 1.2, batch_no: 'B2025001' },
      { product_id: productIds[10]!, qty: 72, price: 2 }
    ]
  })

  // 销售 3 单（覆盖 VIP 等级价、批发价、普通零售价）
  sale.create({ customer_id: customerIds[0]!, warehouse_id: mainWh, date: d(4), remark: '阳光超市周补', items: [item(0, 20), item(2, 30, 1.6)] })
  sale.create({ customer_id: customerIds[3]!, warehouse_id: mainWh, date: d(3), remark: '天天批发部', items: [item(6, 10, 16), item(5, 60, 1.1)] })
  sale.create({ customer_id: customerIds[1]!, warehouse_id: mainWh, date: d(2), remark: '惠民便利', items: [item(8, 24), item(10, 24, 2.5)] })

  // 零售 2 笔（现金 + 微信）
  retail.create({ warehouse_id: mainWh, account_id: cashAcc, date: d(1), items: [item(10, 2, 3), item(5, 2, 1.5)] })
  retail.create({ warehouse_id: mainWh, account_id: wechatAcc, date: d(0), items: [item(2, 4, 2), item(8, 2, 4.5)] })

  // 报价 → 销售订单 → 销售 转单链（操作员 1 = 内置管理员）
  const quote = workflow.save({ kind: 'quote', warehouse_id: mainWh, partner_id: customerIds[6]!, date: d(2), remark: '城东超市询价', items: [item(6, 20, 16), item(7, 15, 18.5)] }, 1)
  workflow.approve(quote.id, 1)
  const order = workflow.convert(quote.id, 1, 'sale_order')
  workflow.approve(order.id, 1)
  const finalSale = workflow.convert(order.id, 1, 'sale')
  workflow.approve(finalSale.id, 1)

  // 收款 2 / 付款 1
  payment.createReceipt({ partner_id: customerIds[0]!, account_id: bankAcc, amount: 120, date: d(1), remark: '阳光超市回款' })
  payment.createReceipt({ partner_id: customerIds[3]!, account_id: cashAcc, amount: 180, date: d(0), remark: '天天批发部回款' })
  payment.createPayment({ partner_id: supplierIds[0]!, account_id: bankAcc, amount: 475, date: d(1), remark: '康师傅货款' })

  // 调拨 1（主仓 → 副仓）
  transfer.create({ warehouse_id: mainWh, warehouse_in_id: subWh, date: d(1), remark: '副仓补货', items: [item(2, 12, 1.2), item(0, 6, 9.5)] })

  // 盘点 1（SP1006 账面 43 件：期初105 − 销售60 − 零售2，实盘 41 → 盘亏 2）
  stocktake.create({ warehouse_id: mainWh, date: d(0), remark: '月末抽盘', items: [{ product_id: productIds[5]!, actual_qty: 41 }] })

  // ---------- 序列号演示（登记 3 台到副仓；序列号台账独立于库存，不影响成本） ----------
  serials.registerIn([
    { product_id: productIds[4]!, warehouse_id: subWh, sn: 'SN-DELI-0001', source: 'demo' },
    { product_id: productIds[4]!, warehouse_id: subWh, sn: 'SN-DELI-0002', source: 'demo' },
    { product_id: productIds[4]!, warehouse_id: subWh, sn: 'SN-DELI-0003', source: 'demo' }
  ])

  return true
}
