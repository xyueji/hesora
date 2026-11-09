import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocItemRow, DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import { resolvePrice } from '../product/customer-price.service'
import { applyRounding, readRoundingSetting } from './rounding.service'
import type { InventoryChange } from '../../../shared/types/inventory'

import type { SaleCreateInput, SaleQuery, SaleReturnInput, SaleItemInput } from '../../../shared/types/sale'
export type { SaleItemInput, SaleCreateInput, SaleQuery } from '../../../shared/types/sale'

export type DB = Database

export interface SaleDetail {
  doc: DocRow
  items: DocItemRow[]
}

/**
 * 销售单：单据（doc/doc_item，type='sale'，编号 XSyyyyMMddNNNN）+ 出库（inventory/cost_log），
 * 二者写在一个事务里，保证单据与库存原子一致（库存不足时单据一并回滚）。
 * rate 语义：1 个录入单位 = rate 个基本单位；出库 change_qty = -(qty*rate)，
 * OUT 不写 unit_cost（成本引擎按移动加权计算）。
 */
export function createSaleService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const selectProduct = db.prepare('SELECT id, name, kind, tracking_type FROM product WHERE id = ?')
  const selectBom = db.prepare('SELECT product_id, qty FROM bom_item WHERE combo_id = ? ORDER BY id')
  const selectChildInv = db.prepare(
    'SELECT qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )

  interface ComboExplode {
    /** combo 行在 input.items 中的下标（doc_item 仍按原行写入） */
    index: number
    comboId: number
    comboName: string
    baseQty: number
    children: Array<{ product_id: number; name: string; qty: number; tracking_type: string; batch_no: string }>
  }

  /**
   * 组合商品销售自动拆解（gap 11）：kind='combo' 且 tracking_type='none' 的销售行，
   * 保留 combo 行（照常计价记账 doc_item），但库存扣减改为按 BOM 拆解为子件 OUT
   * （每子件 qty = 行基本单位数量 × bom.qty，成本走子件 moving_cost——与
   * assemble.service 组装出库同一语义：出库前读 moving_cost 作为成本依据）。
   * combo 本身无库存概念，不出库。库存不足抛 NOT_ENOUGH 指明子件名。
   *
   * 批次子件：combo 行未带 batch_no 时抛 VALIDATION 提示需批次；序列号子件暂不支持
   * 拆解销售，抛 VALIDATION。无 BOM 的 combo 抛 VALIDATION。
   */
  function explodeCombos(items: SaleItemInput[]): ComboExplode[] {
    const explodes: ComboExplode[] = []
    for (let index = 0; index < items.length; index++) {
      const it = items[index]!
      const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
      const baseQty = Number(it.qty) * rate
      const p = selectProduct.get(it.product_id) as
        | { id: number; name: string; kind: string; tracking_type: string }
        | undefined
      if (!p) throw new BizError('NOT_FOUND', `商品不存在：${it.product_id}`)
      if (p.kind !== 'combo' || p.tracking_type !== 'none') continue
      const bom = selectBom.all(p.id) as Array<{ product_id: number; qty: number }>
      if (bom.length === 0) {
        throw new BizError('VALIDATION', `组合商品未配置 BOM，无法销售拆解：${p.name}`)
      }
      const children = bom.map((b) => {
        const child = selectProduct.get(b.product_id) as
          | { id: number; name: string; tracking_type: string }
          | undefined
        if (!child) throw new BizError('NOT_FOUND', `商品不存在：${b.product_id}`)
        if (child.tracking_type === 'serial') {
          throw new BizError('VALIDATION', `组合商品含序列号子件，暂不支持拆解销售：${p.name} → ${child.name}`)
        }
        if (child.tracking_type === 'batch' && !(it.batch_no ?? '').trim()) {
          throw new BizError('VALIDATION', `组合商品含批次管理子件，请在销售行填写批次号：${p.name} → ${child.name}`)
        }
        return {
          product_id: b.product_id,
          name: child.name,
          qty: baseQty * b.qty,
          tracking_type: child.tracking_type,
          batch_no: child.tracking_type === 'batch' ? (it.batch_no ?? '').trim() : ''
        }
      })
      explodes.push({ index, comboId: p.id, comboName: p.name, baseQty, children })
    }
    return explodes
  }

  /** 组合行不产生自身库存变动；其子件 OUT 成本在出库前按 moving_cost 预读（对齐 assemble）。 */
  function buildComboChanges(
    explode: ComboExplode,
    warehouseId: number,
    docId: number,
    docItemIds: Array<number | undefined>,
    date?: string
  ): InventoryChange[] {
    const notEnough: string[] = []
    for (const c of explode.children) {
      const row = selectChildInv.get(c.product_id, warehouseId, c.batch_no) as
        | { qty: number; moving_cost: number }
        | undefined
      if (!row || row.qty < c.qty) {
        notEnough.push(`${c.name} 需 ${c.qty}`)
      }
    }
    if (notEnough.length > 0) {
      throw new BizError('NOT_ENOUGH', `库存不足：${notEnough.join('；')}`)
    }
    return explode.children.map(
      (c): InventoryChange => ({
        product_id: c.product_id,
        warehouse_id: warehouseId,
        batch_no: c.batch_no,
        change_qty: -c.qty,
        source: 'sale',
        source_id: docId,
        doc_item_id: docItemIds[explode.index],
        date
      })
    )
  }

  /** 明细单价：显式传入（含 0）时原样使用；未传/null 时按取价链路兜底（专属价>等级价>零售价） */
  function resolveItemPrice(
    customerId: number | null | undefined,
    it: { product_id: number; price?: number | null }
  ): number {
    if (it.price !== undefined && it.price !== null) return Number(it.price)
    const priceLevel =
      customerId != null
        ? (db.prepare('SELECT price_level FROM customer WHERE id = ?').get(customerId) as
            | { price_level: string | null }
            | undefined)?.price_level ?? null
        : null
    return resolvePrice(db, { customer_id: customerId, product_id: it.product_id, price_level: priceLevel })
  }

  function create(input: SaleCreateInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.customer_id !== undefined && input.customer_id !== null) {
      const cus = db.prepare('SELECT id FROM customer WHERE id = ?').get(Number(input.customer_id))
      if (!cus) throw new BizError('NOT_FOUND', `客户不存在：${input.customer_id}`)
    }
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '销售明细不能为空')
    }
    for (const it of input.items) {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        throw new BizError('VALIDATION', '明细数量必须大于0')
      }
      const price = Number(it.price ?? 0)
      if (!Number.isFinite(price) || price < 0) {
        throw new BizError('VALIDATION', '明细单价不能为负数')
      }
    }
    let doc: DocRow | undefined
    db.transaction(() => {
      // 让利闭环：整单立减校验（≥0、两位小数、< 商品合计）
      const preferentialInput = input.preferential_amount !== undefined && input.preferential_amount !== null
        ? Number(input.preferential_amount) : 0
      if (preferentialInput < 0 || Math.abs(preferentialInput * 100 - Math.round(preferentialInput * 100)) > 1e-7) {
        throw new BizError('VALIDATION', '整单优惠金额必须不小于0且最多保留两位小数')
      }
      const grossOfInput = input.items.reduce((sum, it) => sum + Number(it.qty) * Number(it.price ?? 0), 0)
      if (preferentialInput > 0 && preferentialInput >= grossOfInput) {
        throw new BizError('VALIDATION', `整单优惠金额（${preferentialInput.toFixed(2)} 元）必须小于商品合计（${grossOfInput.toFixed(2)} 元）`)
      }
      // P1 功能 #2 预存款抵扣校验：需客户、金额合法且不超余额；散客不可用
      const prepaidAmount = input.prepaid_amount !== undefined ? Number(input.prepaid_amount) : 0
      if (prepaidAmount !== 0) {
        if (!(prepaidAmount > 0) || Math.abs(prepaidAmount * 100 - Math.round(prepaidAmount * 100)) > 1e-7) {
          throw new BizError('VALIDATION', '预存款抵扣金额必须大于0且最多保留两位小数')
        }
        if (input.customer_id === undefined || input.customer_id === null) {
          throw new BizError('VALIDATION', '散客不可使用预存款，请先选择客户')
        }
        const cus = db.prepare('SELECT prepaid FROM customer WHERE id = ?').get(Number(input.customer_id)) as
          | { prepaid: number }
          | undefined
        if (!cus) throw new BizError('NOT_FOUND', `客户不存在：${input.customer_id}`)
        if (cus.prepaid < prepaidAmount) {
          throw new BizError('PREPAID_INSUFFICIENT', `预存款不足：当前余额 ${cus.prepaid.toFixed(2)} 元，需抵扣 ${prepaidAmount.toFixed(2)} 元`)
        }
      }
      // 组合商品销售拆解校验（BOM/子件 tracking 约束）放在写单前，失败整体回滚
      const explodes = explodeCombos(input.items)
      doc = docService.create({
        type: 'sale',
        operator: input.operator,
        date: input.date,
        partner_id: input.customer_id,
        warehouse_id: warehouseId,
        remark: input.remark,
        // ── S 级功能批次 B ──
        external_no: input.external_no,
        invoice_status: input.invoice_status,
        express_com: input.express_com,
        express_no: input.express_no,
        delivery_status: input.delivery_status,
        items: input.items.map((it) => ({
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: resolveItemPrice(input.customer_id, it),
          commission_rate: it.commission_rate
        }))
      })
      const docItems = docService.getItems(doc.id)
      const docItemIds = docItems.map((d) => d.id)
      const changes: InventoryChange[] = input.items
        .map((it, index) => {
          const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
          return {
            product_id: it.product_id,
            warehouse_id: warehouseId,
            batch_no: (it.batch_no ?? '').trim(),
            change_qty: -(Number(it.qty) * rate),
            unit_cost: 0,
            source: 'sale',
            source_id: doc?.id ?? 0,
            doc_item_id: docItems[index]?.id,
            date: doc?.date,
            serial_numbers: it.serial_numbers,
            production_date: it.production_date,
            expire_date: it.expire_date
          }
        })
        // 组合商品行不出库（无库存概念），改由拆解出的子件 OUT 承接
        .filter((_, index) => !explodes.some((e) => e.index === index))
      for (const e of explodes) {
        changes.push(...buildComboChanges(e, warehouseId, doc?.id ?? 0, docItemIds, doc?.date))
      }
      inventoryService.applyChanges(changes)
      // P1 功能 #2：预存款抵扣过账——doc.prepaid_amount 落列、扣减客户预存款、
      // 写 fund_flow（doc_type sale，direction 'in'，带 partner_id）。同一事务保证原子性。
      if (prepaidAmount > 0 && doc) {
        db.prepare('UPDATE doc SET prepaid_amount = ? WHERE id = ?').run(prepaidAmount, doc.id)
        db.prepare('UPDATE customer SET prepaid = prepaid - ? WHERE id = ?').run(prepaidAmount, Number(input.customer_id))
        // fund_flow.account_id NOT NULL：预存款抵扣不新增现金，记账账户取客户
        // 计入预存款时收款的账户（最近一笔 prepaid 收款流水），兜底取第一个账户
        const acct = db.prepare(`
          SELECT f.account_id FROM fund_flow f JOIN doc d ON d.id = f.doc_id
          WHERE d.partner_id = ? AND d.type = 'receipt' AND d.charge_type = 'prepaid'
          ORDER BY f.id DESC LIMIT 1
        `).pluck().get(Number(input.customer_id)) as number | undefined
        const accountId2 = acct ?? (db.prepare('SELECT id FROM fund_account ORDER BY id LIMIT 1').pluck().get() as number | undefined)
        if (accountId2 === undefined) throw new BizError('VALIDATION', '未找到资金账户，无法登记预存款抵扣')
        db.prepare(`
          INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark, partner_id)
          VALUES (?, 'sale', ?, ?, 'in', ?, ?, ?)
        `).run(accountId2, doc.id, prepaidAmount, doc.date, input.remark ?? '预存款抵扣', Number(input.customer_id))
      }
      // 让利闭环：整单优惠 = 立减 + 开单抹零差额，落 doc.preferential_amount，
      // total_amount = 商品合计（折扣后）− 优惠；只影响应收/实收，不入库存成本（上段已按原价出库）。
      if (doc) {
        const rounding = readRoundingSetting(db)
        const gross = docItems.reduce((sum, it) => sum + Number(it.amount), 0)
        const rounded = applyRounding(rounding, gross)
        const preferential = Number((preferentialInput + rounded.preferential).toFixed(2))
        const netTotal = Number((gross - preferential).toFixed(2))
        if (preferential > 0 && netTotal !== Number(doc.total_amount)) {
          db.prepare('UPDATE doc SET preferential_amount = ?, total_amount = ? WHERE id = ?').run(preferential, netTotal, doc.id)
          doc = { ...doc, preferential_amount: preferential, total_amount: netTotal }
        }
      }
    })()
    return doc as DocRow
  }

  /** 退货冲减往来余额。选择有效账户时，同时登记实际退款。 */
  function createReturn(input: SaleReturnInput): DocRow {
    const warehouseId = Number(input.warehouse_id)
    if (!Number.isInteger(warehouseId)) {
      throw new BizError('VALIDATION', '仓库不能为空')
    }
    const wh = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!wh) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
    if (input.customer_id !== undefined && input.customer_id !== null) {
      const cus = db.prepare('SELECT id FROM customer WHERE id = ?').get(Number(input.customer_id))
      if (!cus) throw new BizError('NOT_FOUND', `客户不存在：${input.customer_id}`)
    }
    if (!input.items || input.items.length === 0) {
      throw new BizError('VALIDATION', '销售退货明细不能为空')
    }
    for (const it of input.items) {
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        throw new BizError('VALIDATION', '明细数量必须大于0')
      }
      const price = Number(it.price ?? 0)
      if (!Number.isFinite(price) || price < 0) {
        throw new BizError('VALIDATION', '明细单价不能为负数')
      }
    }
    const accountId = input.account_id ?? null
    let doc: DocRow | undefined
    db.transaction(() => {
      if (accountId !== null) {
        const account = db.prepare('SELECT id FROM fund_account WHERE id = ? AND disabled = 0').get(accountId)
        if (!account) throw new BizError('NOT_FOUND', '结算账户不存在或已停用')
      }
      doc = docService.create({
        type: 'sale_return',
        date: input.date,
        partner_id: input.customer_id,
        warehouse_id: warehouseId,
        account_id: accountId ?? undefined,
        source_doc_id: input.source_doc_id,
        remark: input.remark,
        // ── S 级功能批次 B ──
        external_no: input.external_no,
        invoice_status: input.invoice_status,
        items: input.items.map((it) => ({
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: it.batch_no?.trim(),
          unit: it.unit,
          rate: it.rate,
          qty: it.qty,
          price: resolveItemPrice(input.customer_id, it),
          commission_rate: it.commission_rate
        }))
      })
      const docItems = docService.getItems(doc.id)
      const changes = input.items.map((it, index) => {
        const rate = it.rate === undefined || it.rate === null ? 1 : Number(it.rate)
        const row = db
          .prepare(
            'SELECT moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
          )
          .get(it.product_id, warehouseId, (it.batch_no ?? '').trim()) as
          | { moving_cost: number }
          | undefined
        return {
          product_id: it.product_id,
          warehouse_id: warehouseId,
          batch_no: (it.batch_no ?? '').trim(),
          change_qty: Number(it.qty) * rate,
          unit_cost: row?.moving_cost ?? 0,
          source: 'sale_return',
          source_id: doc?.id ?? 0,
          doc_item_id: docItems[index]?.id,
          date: doc?.date,
          source_doc_id: input.source_doc_id,
          serial_numbers: it.serial_numbers,
          production_date: it.production_date,
          expire_date: it.expire_date
        }
      })
      inventoryService.applyChanges(changes)
      const total = doc?.total_amount ?? 0
      if (accountId !== null && total > 0) {
        db.prepare(
          `INSERT INTO fund_flow (account_id, doc_type, doc_id, amount, direction, date, remark, partner_id)
           VALUES (?, 'sale_return', ?, ?, 'out', ?, ?, ?)`
        ).run(
          accountId,
          doc?.id ?? 0,
          total,
          doc?.date ?? '',
          input.remark ?? null,
          input.customer_id ?? null
        )
      }
    }).immediate()
    return doc as DocRow
  }

  function getDetail(id: number): SaleDetail {
    const doc = docService.getById(id)
    if (!doc || (doc.type !== 'sale' && doc.type !== 'sale_return')) {
      throw new BizError('NOT_FOUND', `销售单不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: SaleQuery): DocPageResult {
    if (q.type !== undefined && q.type !== 'sale' && q.type !== 'sale_return') {
      throw new BizError('VALIDATION', '销售单据类型无效')
    }
    const inner: DocQuery = {
      types: q.type ? [q.type] : ['sale', 'sale_return'],
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      partner_id: q.partner_id,
      // ── S 级功能批次 B ──
      invoice_status: q.invoice_status,
      delivery_status: q.delivery_status,
      page: q.page,
      pageSize: q.pageSize
    }
    return docService.query(inner)
  }

  return { create, createReturn, getDetail, query }
}

export type SaleService = ReturnType<typeof createSaleService>
