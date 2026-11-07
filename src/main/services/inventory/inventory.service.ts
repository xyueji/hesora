import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type { CostLogRow, InventoryChange, InventoryRow, StockPageResult, StockQuery } from '../../../shared/types/inventory'

export type DB = Database

interface InvRow {
  id: number
  product_id: number
  warehouse_id: number
  batch_no: string
  qty: number
  moving_cost: number
}

export function createInventoryService(db: DB) {
  const selectInv = db.prepare(
    'SELECT * FROM inventory WHERE product_id = ? AND warehouse_id = ? AND batch_no = ?'
  )
  const insertInv = db.prepare(
    'INSERT INTO inventory (product_id, warehouse_id, batch_no, qty, moving_cost) VALUES (?, ?, ?, ?, ?)'
  )
  const updateInv = db.prepare(
    "UPDATE inventory SET qty = ?, moving_cost = ? WHERE id = ?"
  )
  const updateInvQty = db.prepare(
    "UPDATE inventory SET qty = ? WHERE id = ?"
  )
  const insertCostLogStmt = db.prepare(`
    INSERT INTO cost_log (product_id, warehouse_id, batch_no, change_qty, unit_cost, after_qty, after_cost, source, source_id)
    VALUES (@product_id, @warehouse_id, @batch_no, @change_qty, @unit_cost, @after_qty, @after_cost, @source, @source_id)
  `)

  function assertRefs(productId: number, warehouseId: number): void {
    const p = db.prepare('SELECT id FROM product WHERE id = ?').get(productId)
    if (!p) throw new BizError('NOT_FOUND', `商品不存在：${productId}`)
    const w = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!w) throw new BizError('NOT_FOUND', `仓库不存在：${warehouseId}`)
  }

  function insertCostLog(
    c: InventoryChange,
    batchNo: string,
    changeQty: number,
    unitCost: number,
    afterQty: number,
    afterCost: number
  ): void {
    insertCostLogStmt.run({
      product_id: c.product_id,
      warehouse_id: c.warehouse_id,
      batch_no: batchNo,
      change_qty: changeQty,
      unit_cost: unitCost,
      after_qty: afterQty,
      after_cost: afterCost,
      source: c.source ?? '',
      source_id: c.source_id ?? null
    })
  }

  function applyOne(c: InventoryChange): void {
    assertRefs(c.product_id, c.warehouse_id)
    const batchNo = c.batch_no ?? ''
    if (!Number.isFinite(c.change_qty) || c.change_qty === 0) {
      throw new BizError('VALIDATION', '变动数量不能为 0')
    }
    const row = selectInv.get(c.product_id, c.warehouse_id, batchNo) as InvRow | undefined

    if (c.change_qty > 0) {
      // IN: unit_cost required >= 0（0 允许，用于盘点新增库存无成本记录等场景）
      const cost = c.unit_cost
      if (cost === undefined || cost === null || !Number.isFinite(cost) || cost < 0) {
        throw new BizError('VALIDATION', '入库必须提供不小于 0 的单价')
      }
      let qty: number
      let movingCost: number
      if (!row) {
        qty = c.change_qty
        movingCost = cost
        insertInv.run(c.product_id, c.warehouse_id, batchNo, qty, movingCost)
      } else {
        qty = row.qty + c.change_qty
        movingCost = (row.qty * row.moving_cost + c.change_qty * cost) / qty
        updateInv.run(qty, movingCost, row.id)
      }
      insertCostLog(c, batchNo, c.change_qty, cost, qty, movingCost)
    } else {
      // OUT: deduct at moving_cost; cost unchanged
      if (!row || row.qty + c.change_qty < 0) {
        throw new BizError('NOT_ENOUGH', '库存不足')
      }
      const qty = row.qty + c.change_qty
      updateInvQty.run(qty, row.id)
      insertCostLog(c, batchNo, c.change_qty, row.moving_cost, qty, row.moving_cost)
    }
  }

  return {
    // All-or-nothing: single transaction around all changes
    applyChanges(changes: InventoryChange[]): void {
      db.transaction(() => {
        for (const c of changes) applyOne(c)
      })()
    },

    getByProduct(productId: number, warehouseId?: number): InventoryRow[] {
      const rows = (
        warehouseId === undefined
          ? db.prepare('SELECT * FROM inventory WHERE product_id = ? ORDER BY batch_no').all(productId)
          : db
              .prepare('SELECT * FROM inventory WHERE product_id = ? AND warehouse_id = ? ORDER BY batch_no')
              .all(productId, warehouseId)
      ) as InvRow[]
      return rows.map((r) => ({
        id: r.id,
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        batch_no: r.batch_no,
        qty: r.qty,
        moving_cost: r.moving_cost
      }))
    },

    listCostLogs(productId: number): CostLogRow[] {
      return db
        .prepare('SELECT * FROM cost_log WHERE product_id = ? ORDER BY id ASC')
        .all(productId) as CostLogRow[]
    },

    // 库存统计：仅显示数量非 0 的批次，含停用商品（停用商品库存仍存在）
    queryStock(query: StockQuery): StockPageResult {
      const conditions: string[] = ['i.qty <> 0']
      const params: Array<string | number> = []
      if (query.keyword) {
        conditions.push('(p.code LIKE ? OR p.name LIKE ?)')
        const kw = `%${query.keyword}%`
        params.push(kw, kw)
      }
      if (query.warehouse_id !== undefined) {
        conditions.push('i.warehouse_id = ?')
        params.push(query.warehouse_id)
      }
      const where = conditions.join(' AND ')

      const baseFrom = `
        FROM inventory i
        JOIN product p ON p.id = i.product_id
        JOIN warehouse w ON w.id = i.warehouse_id
        WHERE ${where}
      `
      const total = (
        db.prepare(`SELECT COUNT(*) AS c ${baseFrom}`).get(...params) as { c: number }
      ).c

      const rows = db
        .prepare(
          `SELECT
            i.product_id,
            p.code AS product_code,
            p.name AS product_name,
            p.base_unit AS unit,
            i.warehouse_id,
            w.name AS warehouse_name,
            i.batch_no,
            i.qty,
            i.moving_cost,
            (
              SELECT GROUP_CONCAT(u.unit || '=' || RTRIM(RTRIM(CAST(u.rate AS TEXT), '0'), '.'), ';')
              FROM product_unit u
              WHERE u.product_id = i.product_id AND u.is_base = 0
            ) AS spec
          ${baseFrom}
          ORDER BY product_code, warehouse_name, batch_no
          LIMIT ? OFFSET ?`
        )
        .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Array<{
        product_id: number
        product_code: string
        product_name: string
        unit: string
        warehouse_id: number
        warehouse_name: string
        batch_no: string
        qty: number
        moving_cost: number
        spec: string | null
      }>

      return {
        total,
        items: rows.map((r) => ({
          product_id: r.product_id,
          product_code: r.product_code,
          product_name: r.product_name,
          spec: r.spec ?? '',
          unit: r.unit,
          warehouse_id: r.warehouse_id,
          warehouse_name: r.warehouse_name,
          batch_no: r.batch_no,
          qty: r.qty,
          moving_cost: r.moving_cost,
          amount: r.qty * r.moving_cost
        }))
      }
    }
  }
}

export type InventoryService = ReturnType<typeof createInventoryService>
