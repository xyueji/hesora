import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { DocPageResult, DocQuery, DocRow } from '../../../shared/types/doc'
import { createDocService, type DocService } from '../doc/doc.service'
import { createInventoryService } from '../inventory/inventory.service'
import type { InventoryChange, InventoryRow } from '../../../shared/types/inventory'
import type {
  AssembleCreateInput,
  AssembleDetail,
  AssembleQuery
} from '../../../shared/types/assemble'

export type DB = Database

interface BomRow {
  product_id: number
  qty: number
}

interface ComboRow {
  id: number
  kind: string
}

/**
 * 组装/拆卸单。doc type='assemble'（编号 ZZ）/'disassemble'（编号 CZ），同事务内
 * 一次 applyChanges。
 *
 * 组装：按 BOM 消耗子件（bom.qty 为子件基本单位用量，子件自身换算率不参与），
 * IN 组合商品 qty 个（基本单位），其入库成本 = Σ(子件消耗量 × 子件出库时点
 * moving_cost) / qty。子件库存不足整体回滚（NOT_ENOUGH）。
 *
 * 拆卸：OUT 组合商品 qty 个（取其 moving_cost），IN 子件，子件入库单价 =
 * 组合商品出库时点 moving_cost / Σbom_qty（近似均摊：无可靠的单件组装成本
 * 留痕，按 BOM 用量均摊可保证成本守恒：Σ 子件入库值 = 组合出库值）。
 */
export function createAssembleService(db: DB) {
  const docService: DocService = createDocService(db)
  const inventoryService = createInventoryService(db)
  const selectCombo = db.prepare('SELECT id, kind FROM product WHERE id = ?')
  const selectWh = db.prepare('SELECT id FROM warehouse WHERE id = ?')
  const selectBom = db.prepare('SELECT product_id, qty FROM bom_item WHERE combo_id = ? ORDER BY id')
  const selectInv = db.prepare(
    'SELECT id, qty, moving_cost FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )

  function validateCommon(input: AssembleCreateInput): { whId: number; combo: ComboRow; qty: number } {
    const whId = Number(input.warehouse_id)
    if (!Number.isInteger(whId)) throw new BizError('VALIDATION', '仓库不能为空')
    if (!selectWh.get(whId)) throw new BizError('NOT_FOUND', `仓库不存在：${whId}`)
    const qty = Number(input.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BizError('VALIDATION', '数量必须大于0')
    }
    const comboId = Number(input.combo_id)
    if (!Number.isInteger(comboId)) throw new BizError('VALIDATION', '组合商品不能为空')
    const combo = selectCombo.get(comboId) as ComboRow | undefined
    if (!combo) throw new BizError('NOT_FOUND', `商品不存在：${comboId}`)
    if (combo.kind !== 'combo') {
      throw new BizError('VALIDATION', '组合商品不存在：该商品不是组合商品')
    }
    return { whId, combo, qty }
  }

  function create(input: AssembleCreateInput): DocRow {
    const { whId, combo, qty } = validateCommon(input)

    let doc: DocRow | undefined
    db.transaction(() => {
      const bom = selectBom.all(combo.id) as BomRow[]
      if (bom.length === 0) {
        throw new BizError('VALIDATION', '组合商品未配置 BOM，无法组装')
      }
      // 出库前先读每个子件的 moving_cost（作为单据价格与组合成本依据）
      interface Consume {
        product_id: number
        qty: number
        cost: number
      }
      const consumes: Consume[] = []
      let totalCost = 0
      for (const b of bom) {
        const need = b.qty * qty
        const row = selectInv.get(b.product_id, whId, '') as
          | Pick<InventoryRow, 'qty' | 'moving_cost'>
          | undefined
        if (!row || row.qty < need) {
          throw new BizError('NOT_ENOUGH', '库存不足')
        }
        totalCost += need * row.moving_cost
        consumes.push({ product_id: b.product_id, qty: need, cost: row.moving_cost })
      }
      const comboCost = totalCost / qty

      // doc items：子件记录正数消耗量（price = 子件 moving_cost），组合行放最后
      doc = docService.create({
        type: 'assemble',
        date: input.date,
        warehouse_id: whId,
        remark: input.remark,
        items: [
          ...consumes.map((c) => ({
            product_id: c.product_id,
            warehouse_id: whId,
            qty: c.qty,
            price: c.cost
          })),
          { product_id: combo.id, warehouse_id: whId, qty, price: comboCost }
        ]
      })
      const sourceId = doc?.id ?? 0
      const changes: InventoryChange[] = [
        ...consumes.map(
          (c): InventoryChange => ({
            product_id: c.product_id,
            warehouse_id: whId,
            change_qty: -c.qty,
            source: 'assemble',
            source_id: sourceId
          })
        ),
        {
          product_id: combo.id,
          warehouse_id: whId,
          change_qty: qty,
          unit_cost: comboCost,
          source: 'assemble',
          source_id: sourceId
        }
      ]
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  function disassemble(input: AssembleCreateInput): DocRow {
    const { whId, combo, qty } = validateCommon(input)

    let doc: DocRow | undefined
    db.transaction(() => {
      const bom = selectBom.all(combo.id) as BomRow[]
      if (bom.length === 0) {
        throw new BizError('VALIDATION', '组合商品未配置 BOM，无法拆卸')
      }
      const sumBomQty = bom.reduce((s, b) => s + b.qty, 0)
      // 先 OUT 组合商品并捕获其出库时点 moving_cost
      const comboInv = selectInv.get(combo.id, whId, '') as
        | Pick<InventoryRow, 'qty' | 'moving_cost'>
        | undefined
      if (!comboInv || comboInv.qty < qty) {
        throw new BizError('NOT_ENOUGH', '库存不足')
      }
      const comboCost = comboInv.moving_cost

      doc = docService.create({
        type: 'disassemble',
        date: input.date,
        warehouse_id: whId,
        remark: input.remark,
        items: [
          { product_id: combo.id, warehouse_id: whId, qty, price: comboCost },
          ...bom.map((b) => ({
            product_id: b.product_id,
            warehouse_id: whId,
            qty: b.qty * qty,
            // 近似均摊：子件单价 = 组合成本 / Σbom_qty，保证成本守恒
            price: comboCost / sumBomQty
          }))
        ]
      })
      const sourceId = doc?.id ?? 0
      const changes: InventoryChange[] = [
        {
          product_id: combo.id,
          warehouse_id: whId,
          change_qty: -qty,
          source: 'disassemble',
          source_id: sourceId
        },
        ...bom.map(
          (b): InventoryChange => ({
            product_id: b.product_id,
            warehouse_id: whId,
            change_qty: b.qty * qty,
            unit_cost: comboCost / sumBomQty,
            source: 'disassemble',
            source_id: sourceId
          })
        )
      ]
      inventoryService.applyChanges(changes)
    })()
    return doc as DocRow
  }

  function getDetail(id: number, type: 'assemble' | 'disassemble'): AssembleDetail {
    const doc = docService.getById(id)
    if (!doc || doc.type !== type) {
      throw new BizError('NOT_FOUND', `单据不存在：${id}`)
    }
    return { doc, items: docService.getItems(id) }
  }

  function query(q: AssembleQuery): DocPageResult {
    const base: Omit<DocQuery, 'type'> = {
      date_from: q.date_from,
      date_to: q.date_to,
      keyword: q.keyword,
      page: q.page,
      pageSize: q.pageSize
    }
    // 无 type 过滤时合并组装/拆卸两类单据
    if (q.type) return docService.query({ ...base, type: q.type })
    const a = docService.query({ ...base, type: 'assemble' })
    const d = docService.query({ ...base, type: 'disassemble' })
    const items = [...a.items, ...d.items].sort((x, y) => y.id - x.id)
    return { total: a.total + d.total, items: items.slice(0, base.pageSize) }
  }

  return {
    create,
    disassemble,
    getDetail: (id: number): AssembleDetail => getDetail(id, 'assemble'),
    getDisassembleDetail: (id: number): AssembleDetail => getDetail(id, 'disassemble'),
    query
  }
}

export type AssembleService = ReturnType<typeof createAssembleService>
