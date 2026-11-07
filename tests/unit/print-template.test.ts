import { describe, it, expect, beforeEach } from 'vitest'
import { openMemDb } from '../helpers/mem-db'
import { createPrintTemplateService } from '../../src/main/services/print/template.service'
import { renderReceiptHtml, renderA4Html, type ReceiptPrintData, type A4PrintData } from '../../src/shared/print/templates'

function setup() {
  const db = openMemDb()
  const svc = createPrintTemplateService(db)
  return { db, svc }
}

const receiptData: ReceiptPrintData = {
  shopName: '禾序测试店',
  docNo: 'LS202611070001',
  date: '2026-11-07',
  items: [{ name: '可乐', unit: '罐', qty: 2, price: 3, amount: 6 }],
  total: 6,
  paymentMethod: '现金',
  remark: '备注内容',
  footer: '谢谢惠顾'
}

const a4Data: A4PrintData = {
  title: '销售单',
  shopName: '禾序测试店',
  partnerName: '张三',
  warehouseName: '主仓',
  docNo: 'XS202611070001',
  date: '2026-11-07',
  items: receiptData.items,
  total: 6,
  remark: '备注内容',
  printDate: '2026-11-07 10:00'
}

describe('print template service', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('CRUD: save creates, list returns, update by id, remove deletes', () => {
    const id = ctx.svc.save({ name: '店用小票', kind: 'receipt', content: JSON.stringify({ showShopHeader: false }) })
    expect(ctx.svc.list()).toHaveLength(1)
    ctx.svc.save({ id, name: '店用小票2', kind: 'receipt', content: '{}' })
    expect(ctx.svc.list()[0]?.name).toBe('店用小票2')
    ctx.svc.remove(id)
    expect(ctx.svc.list()).toHaveLength(0)
  })

  it('duplicate template name rejected', () => {
    ctx.svc.save({ name: 'A', kind: 'receipt', content: '{}' })
    expect(() => ctx.svc.save({ name: 'A', kind: 'a4', content: '{}' })).toThrow(/已存在/)
  })

  it('setDefault makes is_default mutually exclusive per kind (transaction)', () => {
    const a = ctx.svc.save({ name: 'R1', kind: 'receipt', content: '{}' })
    const b = ctx.svc.save({ name: 'R2', kind: 'receipt', content: '{}' })
    const a4 = ctx.svc.save({ name: 'A1', kind: 'a4', content: '{}' })
    ctx.svc.setDefault(a)
    ctx.svc.setDefault(b)
    const defaults = (ctx.db.prepare("SELECT id, kind FROM print_template WHERE is_default = 1").all() as Array<{ id: number; kind: string }>)
    expect(defaults).toEqual([{ id: b, kind: 'receipt' }])
    ctx.svc.setDefault(a4)
    expect(ctx.svc.getDefault('a4')?.id).toBe(a4)
    expect(ctx.svc.getDefault('receipt')?.id).toBe(b)
  })

  it('getDefault returns undefined when no default', () => {
    expect(ctx.svc.getDefault('receipt')).toBeUndefined()
  })

  it('render switches: options off hide shop header / amount column / remark; default (no template) keeps current behavior', () => {
    // 无模板/无开关：现状行为（有店铺头、有金额列、有备注）
    const baseHtml = renderReceiptHtml(receiptData)
    expect(baseHtml).toContain('禾序测试店')
    expect(baseHtml).toContain('备注：备注内容')
    // 开关全关
    const offHtml = renderReceiptHtml(receiptData, { showShopHeader: false, showRemark: false, showPaymentMethod: false })
    expect(offHtml).not.toContain('禾序测试店')
    expect(offHtml).not.toContain('备注：')
    expect(offHtml).not.toContain('收款方式')
    // 开关缺省字段：回退现状
    const partialHtml = renderReceiptHtml(receiptData, {})
    expect(partialHtml).toContain('禾序测试店')
    // A4：金额列开关
    const a4NoAmount = renderA4Html(a4Data, { showAmountColumn: false })
    expect(a4NoAmount).not.toContain('>金额<')
    expect(renderA4Html(a4Data)).toContain('>金额<')
  })
})
