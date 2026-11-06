// 导入服务（纯）：解析 CSV 文本并写入主档 / 期初库存。禁止 import electron / fs。
import type { Database } from 'better-sqlite3'
import { parseCsv } from '../../../shared/csv'
import type { TrackingType } from '../../../shared/types/product'
import { createProductService } from '../product/product.service'
import { createInventoryService } from '../inventory/inventory.service'

export type DB = Database

export interface ImportError {
  row: number // 1-based 行号（含表头，数据从 2 开始）
  message: string
}

export interface ImportResult {
  created: number
  updated: number
  errors: ImportError[]
}

function toNum(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const TRACKING: Record<string, TrackingType> = {
  无: 'none',
  none: 'none',
  批次: 'batch',
  batch: 'batch',
  序列号: 'serial',
  serial: 'serial'
}

export function createImportService(db: DB) {
  const productService = createProductService(db)
  const inventoryService = createInventoryService(db)

  function importProducts(csvText: string): ImportResult {
    const rows = parseCsv(csvText)
    const result: ImportResult = { created: 0, updated: 0, errors: [] }
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1 // 数据行从第 2 行开始
      const cols = rows[i] ?? []
      try {
        const code = (cols[0] ?? '').trim()
        const name = (cols[1] ?? '').trim()
        if (code === '') throw new Error('编码不能为空')
        if (name === '') throw new Error('名称不能为空')
        const baseUnit = (cols[2] ?? '').trim()
        if (baseUnit === '') throw new Error('基本单位不能为空')
        const retail = toNum(cols[3]) ?? 0
        const trade = toNum(cols[4]) ?? 0
        const purchase = toNum(cols[5]) ?? 0
        const trackingRaw = (cols[6] ?? '').trim()
        const tracking = TRACKING[trackingRaw] ?? 'none'

        const existing = db
          .prepare('SELECT id FROM product WHERE code = ?')
          .get(code) as { id: number } | undefined
        if (existing) {
          productService.update(existing.id, {
            name,
            base_unit: baseUnit,
            retail_price: retail,
            trade_price: trade,
            purchase_price: purchase,
            tracking_type: tracking
          })
          result.updated++
        } else {
          productService.create({
            code,
            name,
            base_unit: baseUnit,
            retail_price: retail,
            trade_price: trade,
            purchase_price: purchase,
            tracking_type: tracking,
            kind: 'standard',
            units: [],
            barcodes: []
          })
          result.created++
        }
      } catch (e) {
        result.errors.push({ row: rowNo, message: String((e as Error)?.message ?? e) })
      }
    }
    return result
  }

  function importOpeningStock(csvText: string, warehouseId: number): ImportResult {
    const rows = parseCsv(csvText)
    const result: ImportResult = { created: 0, updated: 0, errors: [] }
    const changes: Array<{ row: number; product_id: number; batch_no: string; qty: number; cost: number }> = []
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1
      const cols = rows[i] ?? []
      try {
        const code = (cols[0] ?? '').trim()
        if (code === '') throw new Error('商品编码不能为空')
        const p = db
          .prepare('SELECT id FROM product WHERE code = ?')
          .get(code) as { id: number } | undefined
        if (!p) throw new Error(`商品不存在：${code}`)
        const qty = toNum(cols[1])
        if (qty === undefined) throw new Error('数量不能为空且必须是数字')
        if (qty < 0) throw new Error('数量不能为负数')
        const cost = toNum(cols[2]) ?? 0
        if (cost < 0) throw new Error('成本单价不能为负数')
        const batch = (cols[3] ?? '').trim()
        changes.push({ row: rowNo, product_id: p.id, batch_no: batch, qty, cost })
      } catch (e) {
        result.errors.push({ row: rowNo, message: String((e as Error)?.message ?? e) })
      }
    }
    if (changes.length === 0) return result
    try {
      inventoryService.applyChanges(
        changes.map((c) => ({
          product_id: c.product_id,
          warehouse_id: warehouseId,
          batch_no: c.batch_no,
          change_qty: c.qty,
          unit_cost: c.cost,
          source: 'import'
        }))
      )
      result.created = changes.length
    } catch (e) {
      // 整批事务失败（如仓库不存在）时按行无法定位，报首行
      result.errors.push({ row: changes[0]!.row, message: String((e as Error)?.message ?? e) })
    }
    return result
  }

  return { importProducts, importOpeningStock }
}

export type ImportService = ReturnType<typeof createImportService>
