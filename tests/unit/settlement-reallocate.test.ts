import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createProductService } from '../../src/main/services/product/product.service'
import { createCustomerService } from '../../src/main/services/customer/customer.service'
import { createWarehouseService } from '../../src/main/services/warehouse/warehouse.service'
import { createSaleService } from '../../src/main/services/sale/sale.service'
import { createPaymentService } from '../../src/main/services/payment/payment.service'
import { createFundService } from '../../src/main/services/fund/fund.service'
import { createPurchaseService } from '../../src/main/services/purchase/purchase.service'
import { createReversalService } from '../../src/main/services/doc/reversal.service'
import type { DB } from '../../src/main/services/payment/payment.service'

// P1-4：历史未分配款项的补核销。本系统口径：核销必须挂在真实资金单上，
// 已进账的钱不能凭空再核销（会双记）。因此补核销路径 = 红冲旧收款单
// （资金流与核销一并回退）→ 重开一张全额核销的新收款单。
// 本测试验证该路径全链路：待核销余额恢复、重新核销、往来余额归零。
describe('settlement: re-allocate previously unallocated receipts via reversal + re-receipt', () => {
  let db: DB
  let productId: number
  let customerId: number
  let whId: number
  let accountId: number
  let saleId: number
  let firstReceiptId: number

  beforeEach(() => {
    db = openMemDb()
    productId = createProductService(db).create({
      code: 'ST1', name: '核销商品', base_unit: '个',
      retail_price: 10, trade_price: 10, purchase_price: 4, tracking_type: 'none'
    })
    customerId = createCustomerService(db).create({ code: 'C1', name: '客户一', opening_receivable: 0 })
    whId = createWarehouseService(db).create({ name: '主仓', is_default: true })
    accountId = createFundService(db).create({ code: 'F1', name: '现金', type: 'cash', opening_balance: 0 })

    // 先采购入库 20 个，保证销售出库有货
    createPurchaseService(db).create({ warehouse_id: whId, items: [{ product_id: productId, unit: '个', qty: 20, price: 4 }] })

    // 卖 100 元
    saleId = createSaleService(db).create({
      date: '2026-01-01', warehouse_id: whId, customer_id: customerId,
      items: [{ product_id: productId, unit: '个', qty: 10, price: 10 }]
    }).id

    // 先收 60，只核销 55（留 5 未分配）
    firstReceiptId = createPaymentService(db).createReceipt({
      partner_id: customerId, account_id: accountId,
      amount: 60, date: '2026-01-02',
      allocations: [{ doc_id: saleId, amount: 55 }]
    }).id
  })

  it('reverses the partial receipt then re-receipts with full allocation', () => {
    const payment = createPaymentService(db)
    const reversal = createReversalService(db)

    // 红冲前：销售单剩 45 待核销
    const before = payment.openDocuments('receipt', customerId, saleId)[0]
    expect(before!.remaining).toBe(45)

    // 红冲旧收款单（资金流与核销一并回退）
    reversal.reverse(firstReceiptId, 'admin')

    // 红冲后：销售单恢复 100 待核销
    const restored = payment.openDocuments('receipt', customerId, saleId)[0]
    expect(restored!.remaining).toBe(100)

    // 重开收款单 100，全额核销
    const receipt2 = payment.createReceipt({
      partner_id: customerId, account_id: accountId,
      amount: 100, date: '2026-01-03',
      allocations: [{ doc_id: saleId, amount: 100 }]
    })
    expect(receipt2.total_amount).toBe(100)

    // 此后销售单无剩余待核销
    expect(payment.openDocuments('receipt', customerId, saleId)).toHaveLength(0)

    // 往来余额归零：销售 100 − (收款60 − 红冲60 + 收款100) = 0
    const balance = db.prepare(`
      SELECT ROUND(COALESCE((SELECT SUM(CASE WHEN type='sale' THEN total_amount ELSE 0 END) FROM doc
        WHERE partner_id = ? AND status='done'),0)
        - COALESCE((SELECT SUM(CASE WHEN f.direction='in' THEN f.amount ELSE -f.amount END) FROM fund_flow f
          JOIN doc d ON d.id=f.doc_id AND f.doc_type='receipt'
          WHERE d.partner_id=?),0),2) AS bal
    `).get(customerId, customerId) as { bal: number }
    expect(balance.bal).toBe(0)
  })
})
