import type { Database } from 'better-sqlite3'
import { BizError } from '../../../shared/result'
import type {
  ConsumeSerialInput,
  RegisterSerialInput,
  SerialFlowPageResult,
  SerialFlowQuery,
  SerialFlowRow,
  SerialStockPageResult,
  SerialStockQuery,
  SerialStockRow,
  SerialValidateDirection,
  ValidateSnResult
} from '../../../shared/types/serial'

export type DB = Database

interface ProductTrackingRow {
  id: number
  tracking_type: string
}

interface SerialNumberRow {
  id: number
  sn: string
  product_id: number
  warehouse_id: number
  batch_no: string
  status: string
  in_qty: number
  out_qty: number
  in_date: string
  out_date: string | null
  in_source: string | null
  in_source_id: number | null
  out_source: string | null
  out_source_id: number | null
  remark: string | null
}

interface StockDbRow {
  id: number
  sn: string
  product_id: number
  product_code: string
  product_name: string
  warehouse_id: number
  warehouse_name: string
  batch_no: string
  status: string
  in_qty: number
  out_qty: number
  in_date: string
  out_date: string | null
  in_source: string | null
  in_source_id: number | null
  in_source_no: string | null
  out_source: string | null
  out_source_id: number | null
  out_source_no: string | null
  remark: string | null
}

interface FlowDbRow {
  id: number
  sn: string
  product_id: number
  product_code: string | null
  product_name: string | null
  doc_id: number | null
  doc_no: string | null
  doc_item_id: number | null
  direction: string
  qty: number
  created_at: string
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

function nowLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`
}

function trimSn(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 序列号（SN）台账服务。
 *
 * 语义（还原自原版进销存的序列号管理）：
 *  - 只有 tracking_type='serial' 的商品才有序列号；入库登记一次，出库核销一次；
 *  - 同一商品下序列号唯一，重复登记直接拒绝（"序列号已存在"）；
 *  - 序列号台账只记数量与流向，不直接改写库存——库存仍由 inventory + cost_log 引擎负责，
 *    这样序列号台账与库存变动解耦，避免两条链路写同一张表。
 */
export function createSerialService(db: DB) {
  const insertSerial = db.prepare(`
    INSERT INTO serial_number (sn, product_id, warehouse_id, batch_no, status, in_qty, out_qty, in_date, in_source, in_source_id, remark)
    VALUES (@sn, @product_id, @warehouse_id, @batch_no, 'in_stock', @in_qty, 0, @in_date, @in_source, @in_source_id, @remark)
  `)
  const insertFlow = db.prepare(`
    INSERT INTO serial_flow (sn, product_id, doc_id, doc_item_id, direction, qty, created_at)
    VALUES (@sn, @product_id, @doc_id, @doc_item_id, @direction, @qty, @created_at)
  `)
  const updateOut = db.prepare(`
    UPDATE serial_number
    SET out_qty = @out_qty, status = @status, out_date = @out_date, out_source = @out_source, out_source_id = @out_source_id
    WHERE id = @id
  `)

  function assertProductIsSerial(productId: number): void {
    const row = db
      .prepare('SELECT id, tracking_type FROM product WHERE id = ?')
      .get(productId) as ProductTrackingRow | undefined
    if (!row || row.tracking_type !== 'serial') {
      throw new BizError('VALIDATION', '该商品未启用序列号')
    }
  }

  function assertWarehouseExists(warehouseId: number): void {
    const row = db.prepare('SELECT id FROM warehouse WHERE id = ?').get(warehouseId)
    if (!row) {
      throw new BizError('VALIDATION', '仓库不存在')
    }
  }

  /** 入库登记：序列号落账（在库）+ 写入库流水。整批在一个事务内，任意一条不合法则全部回滚。 */
  function registerIn(items: RegisterSerialInput[]): { count: number; ids: number[] } {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BizError('VALIDATION', '序列号登记列表不能为空')
    }
    const ids: number[] = []
    db.transaction(() => {
      const seen = new Set<string>()
      for (const item of items) {
        const sn = trimSn(item.sn)
        if (!sn) {
          throw new BizError('VALIDATION', '序列号不能为空')
        }
        const productId = Number(item.product_id)
        const warehouseId = Number(item.warehouse_id)
        assertProductIsSerial(productId)
        assertWarehouseExists(warehouseId)
        const key = `${productId}:${sn}`
        if (seen.has(key)) {
          throw new BizError('VALIDATION', `序列号已存在：${sn}`)
        }
        const exists = db
          .prepare('SELECT id FROM serial_number WHERE sn = ? AND product_id = ?')
          .get(sn, productId)
        if (exists) {
          throw new BizError('VALIDATION', `序列号已存在：${sn}`)
        }
        const qty = item.qty === undefined || item.qty === null ? 1 : Number(item.qty)
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new BizError('VALIDATION', '序列号入库数量必须大于0')
        }
        const id = Number(
          insertSerial.run({
            sn,
            product_id: productId,
            warehouse_id: warehouseId,
            batch_no: item.batch_no ?? '',
            in_qty: qty,
            in_date: nowLocal(),
            in_source: item.source ?? null,
            in_source_id: item.source_id ?? null,
            remark: item.remark ?? null
          }).lastInsertRowid
        )
        insertFlow.run({
          sn,
          product_id: productId,
          doc_id: item.source_id ?? null,
          doc_item_id: item.doc_item_id ?? null,
          direction: 'in',
          qty,
          created_at: nowLocal()
        })
        seen.add(key)
        ids.push(id)
      }
    }).immediate()
    return { count: ids.length, ids }
  }

  /** 出库核销：序列号从在库转为已出库（或部分核销），并写出一条库流水。 */
  function consumeOut(items: ConsumeSerialInput[]): { count: number; ids: number[] } {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BizError('VALIDATION', '序列号出库列表不能为空')
    }
    const ids: number[] = []
    db.transaction(() => {
      for (const item of items) {
        const sn = trimSn(item.sn)
        if (!sn) {
          throw new BizError('VALIDATION', '序列号不能为空')
        }
        const qty = item.qty === undefined || item.qty === null ? 1 : Number(item.qty)
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new BizError('VALIDATION', '序列号出库数量必须大于0')
        }
        const productId = Number(item.product_id)
        const row = db
          .prepare('SELECT * FROM serial_number WHERE sn = ? AND product_id = ?')
          .get(sn, productId) as SerialNumberRow | undefined
        if (!row || row.status !== 'in_stock') {
          throw new BizError('VALIDATION', `序列号不存在或已出库：${sn}`)
        }
        const outQty = Number(row.out_qty) + qty
        const exhausted = outQty >= Number(row.in_qty) - 1e-9
        updateOut.run({
          id: row.id,
          out_qty: outQty,
          status: exhausted ? 'out' : 'in_stock',
          out_date: exhausted ? nowLocal() : row.out_date,
          out_source: item.source ?? row.out_source,
          out_source_id: item.source_id ?? row.out_source_id
        })
        insertFlow.run({
          sn,
          product_id: productId,
          doc_id: item.source_id ?? null,
          doc_item_id: item.doc_item_id ?? null,
          direction: 'out',
          qty,
          created_at: nowLocal()
        })
        ids.push(row.id)
      }
    }).immediate()
    return { count: ids.length, ids }
  }

  /** 序列号台账：在库 / 已出库序列号列表（含商品、仓库、来源单据号）。 */
  function listStock(query: SerialStockQuery): SerialStockPageResult {
    const page = Math.max(Math.trunc(Number(query?.page) || 1), 1)
    const pageSize = Math.min(Math.max(Math.trunc(Number(query?.pageSize) || 20), 1), 200)
    const where: string[] = []
    const params: Record<string, unknown> = {}
    const keyword = typeof query?.keyword === 'string' ? query.keyword.trim() : ''
    if (keyword) {
      where.push('(s.sn LIKE @kw OR p.code LIKE @kw OR p.name LIKE @kw)')
      params['kw'] = `%${keyword}%`
    }
    if (query?.product_id !== undefined && query?.product_id !== null) {
      where.push('s.product_id = @product_id')
      params['product_id'] = Number(query.product_id)
    }
    if (query?.warehouse_id !== undefined && query?.warehouse_id !== null) {
      where.push('s.warehouse_id = @warehouse_id')
      params['warehouse_id'] = Number(query.warehouse_id)
    }
    if (query?.status) {
      where.push('s.status = @status')
      params['status'] = query.status
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c
             FROM serial_number s JOIN product p ON p.id = s.product_id
             ${whereSql}`
          )
          .get(params) as { c: number }
      ).c
    )
    const rows = db
      .prepare(
        `SELECT s.id, s.sn, s.product_id, p.code AS product_code, p.name AS product_name,
                s.warehouse_id, w.name AS warehouse_name, s.batch_no, s.status,
                s.in_qty, s.out_qty, s.in_date, s.out_date,
                s.in_source, s.in_source_id, d_in.no AS in_source_no,
                s.out_source, s.out_source_id, d_out.no AS out_source_no,
                s.remark
         FROM serial_number s
         JOIN product p ON p.id = s.product_id
         JOIN warehouse w ON w.id = s.warehouse_id
         LEFT JOIN doc d_in ON d_in.id = s.in_source_id AND d_in.type = s.in_source
         LEFT JOIN doc d_out ON d_out.id = s.out_source_id AND d_out.type = s.out_source
         ${whereSql}
         ORDER BY s.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as StockDbRow[]
    const items: SerialStockRow[] = rows.map((r) => ({
      id: r.id,
      sn: r.sn,
      product_id: r.product_id,
      product_code: r.product_code,
      product_name: r.product_name,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name,
      batch_no: r.batch_no ?? '',
      status: r.status as SerialStockRow['status'],
      in_qty: r.in_qty,
      out_qty: r.out_qty,
      in_date: r.in_date,
      out_date: r.out_date ?? null,
      in_source: r.in_source ?? null,
      in_source_id: r.in_source_id ?? null,
      in_source_no: r.in_source_no ?? null,
      out_source: r.out_source ?? null,
      out_source_id: r.out_source_id ?? null,
      out_source_no: r.out_source_no ?? null,
      remark: r.remark ?? null
    }))
    return { total, items }
  }

  /** 序列号流向：出入库流水（含来源单据号）。 */
  function listFlow(query: SerialFlowQuery): SerialFlowPageResult {
    const page = Math.max(Math.trunc(Number(query?.page) || 1), 1)
    const pageSize = Math.min(Math.max(Math.trunc(Number(query?.pageSize) || 20), 1), 200)
    const where: string[] = []
    const params: Record<string, unknown> = {}
    const sn = typeof query?.sn === 'string' ? query.sn.trim() : ''
    if (sn) {
      where.push('f.sn LIKE @sn')
      params['sn'] = `%${sn}%`
    }
    if (query?.product_id !== undefined && query?.product_id !== null) {
      where.push('f.product_id = @product_id')
      params['product_id'] = Number(query.product_id)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c
             FROM serial_flow f LEFT JOIN product p ON p.id = f.product_id
             ${whereSql}`
          )
          .get(params) as { c: number }
      ).c
    )
    const rows = db
      .prepare(
        `SELECT f.id, f.sn, f.product_id, p.code AS product_code, p.name AS product_name,
                f.doc_id, d.no AS doc_no, f.doc_item_id, f.direction, f.qty, f.created_at
         FROM serial_flow f
         LEFT JOIN product p ON p.id = f.product_id
         LEFT JOIN doc d ON d.id = f.doc_id
         ${whereSql}
         ORDER BY f.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as FlowDbRow[]
    const items: SerialFlowRow[] = rows.map((r) => ({
      id: r.id,
      sn: r.sn,
      product_id: r.product_id,
      product_code: r.product_code ?? '',
      product_name: r.product_name ?? '',
      doc_id: r.doc_id ?? null,
      doc_no: r.doc_no ?? null,
      doc_item_id: r.doc_item_id ?? null,
      direction: r.direction as SerialFlowRow['direction'],
      qty: r.qty,
      created_at: r.created_at
    }))
    return { total, items }
  }

  /**
   * 序列号预校验（保存单据前调用）。
   *  - direction='in'：报出该商品台账中已存在的序列号（不可重复登记）；
   *  - direction='out'：报出台账中不存在/已出库的序列号，以及本次列表中重复录入的序列号。
   */
  function validateSns(
    productId: number,
    sns: string[],
    direction: SerialValidateDirection = 'in'
  ): ValidateSnResult {
    const list = (Array.isArray(sns) ? sns : [])
      .map((s) => trimSn(s))
      .filter((s) => s !== '')
    const duplicates: string[] = []
    const unknown: string[] = []
    const pid = Number(productId)
    if (direction === 'out') {
      const seen = new Set<string>()
      for (const sn of list) {
        if (seen.has(sn)) {
          if (!duplicates.includes(sn)) duplicates.push(sn)
          continue
        }
        seen.add(sn)
        const row = db
          .prepare('SELECT status FROM serial_number WHERE sn = ? AND product_id = ?')
          .get(sn, pid) as { status: string } | undefined
        if (!row || row.status !== 'in_stock') {
          unknown.push(sn)
        }
      }
      return { ok: duplicates.length === 0 && unknown.length === 0, duplicates, unknown }
    }
    for (const sn of list) {
      const row = db
        .prepare('SELECT id FROM serial_number WHERE sn = ? AND product_id = ?')
        .get(sn, pid)
      if (row && !duplicates.includes(sn)) {
        duplicates.push(sn)
      }
    }
    return { ok: duplicates.length === 0, duplicates, unknown }
  }

  /** 在库序列号数量（按序列号个数计，不按数量合计）。 */
  function stockOf(productId: number): number {
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM serial_number WHERE product_id = ? AND status = 'in_stock'")
      .get(Number(productId)) as { c: number }
    return Number(row.c)
  }

  return { registerIn, consumeOut, listStock, listFlow, validateSns, stockOf }
}

export type SerialService = ReturnType<typeof createSerialService>
