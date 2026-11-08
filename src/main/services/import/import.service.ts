// 导入服务（纯）：解析 CSV 文本并写入主档 / 期初库存。禁止 import electron / fs。
import type { Database } from 'better-sqlite3'
import { parseCsv } from '../../../shared/csv'
import { BizError } from '../../../shared/result'
import type { TrackingType, Product } from '../../../shared/types/product'
import type { OpeningStockPreview } from '../../../shared/types/opening'
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

export interface ProductPreviewLine {
  row: number
  code: string
  name: string
  base_unit: string
  retail_price: number
  trade_price: number
  purchase_price: number
  /** 存在 → 更新；否则 → 新建 */
  existing_id: number | null
}

export interface ProductPreview {
  lines: ProductPreviewLine[]
  willCreate: number
  willUpdate: number
  errors: ImportError[]
}

function toNum(v: string | undefined, label: string): number | undefined {
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new BizError('VALIDATION', `${label}必须是数字`)
  if (n < 0) throw new BizError('VALIDATION', `${label}不能为负数`)
  return n
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

  /** 商品导入预览（dry-run）：逐行校验并判断新建/更新，不写库。 */
  function previewProducts(csvText: string): ProductPreview {
    const rows = parseCsv(csvText)
    const result: ProductPreview = { lines: [], willCreate: 0, willUpdate: 0, errors: [] }
    const findId = db.prepare('SELECT id FROM product WHERE code = ?')
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1
      const cols = rows[i] ?? []
      try {
        const code = (cols[0] ?? '').trim()
        const name = (cols[1] ?? '').trim()
        if (code === '') throw new Error('编码不能为空')
        if (name === '') throw new Error('名称不能为空')
        const baseUnit = (cols[4] ?? '').trim()
        if (baseUnit === '') throw new Error('基本单位不能为空')
        const retail = toNum(cols[5], '零售价') ?? 0
        const trade = toNum(cols[6], '批发价') ?? 0
        const purchase = toNum(cols[7], '进价') ?? 0
        toNum(cols[8], '最低库存')
        const trackingRaw = (cols[9] ?? '').trim()
        if (trackingRaw && !Object.hasOwn(TRACKING, trackingRaw)) {
          throw new BizError('VALIDATION', '追踪方式须为无、批次或序列号')
        }
        const existing = findId.get(code) as { id: number } | undefined
        result.lines.push({
          row: rowNo, code, name, base_unit: baseUnit,
          retail_price: retail, trade_price: trade, purchase_price: purchase,
          existing_id: existing?.id ?? null
        })
        if (existing) result.willUpdate++
        else result.willCreate++
      } catch (e) {
        result.errors.push({ row: rowNo, message: String((e as Error)?.message ?? e) })
      }
    }
    return result
  }

  function importProducts(csvText: string): ImportResult {
    const rows = parseCsv(csvText)
    const result: ImportResult = { created: 0, updated: 0, errors: [] }
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1 // 数据行从第 2 行开始
      const cols = rows[i] ?? []
      try {
        // 列顺序与 PRODUCT_IMPORT_COLUMNS 一致：
        // 编码,名称,规格,类别,基本单位,零售价,批发价,进价,最低库存,追踪方式,条码
        const code = (cols[0] ?? '').trim()
        const name = (cols[1] ?? '').trim()
        if (code === '') throw new Error('编码不能为空')
        if (name === '') throw new Error('名称不能为空')
        const spec = (cols[2] ?? '').trim()
        const category = (cols[3] ?? '').trim()
        const baseUnit = (cols[4] ?? '').trim()
        if (baseUnit === '') throw new Error('基本单位不能为空')
        const retail = toNum(cols[5], '零售价') ?? 0
        const trade = toNum(cols[6], '批发价') ?? 0
        const purchase = toNum(cols[7], '进价') ?? 0
        const minStock = toNum(cols[8], '最低库存') ?? null
        const trackingRaw = (cols[9] ?? '').trim()
        if (trackingRaw && !Object.hasOwn(TRACKING, trackingRaw)) {
          throw new BizError('VALIDATION', '追踪方式须为无、批次或序列号')
        }
        const tracking = TRACKING[trackingRaw] ?? 'none'
        // 条码列：分号分隔多条；解析失败（重复等）由 create/update 报行级错误
        const barcodeList = (cols[10] ?? '')
          .split(/[;；]/)
          .map((b) => b.trim())
          .filter((b) => b !== '')

        const existing = db
          .prepare('SELECT id FROM product WHERE code = ?')
          .get(code) as { id: number } | undefined
        // 规格/类别/最低库存仅在有值时覆盖（CSV 空列不抹掉已有数据）
        const extras: Partial<Product> = {}
        if (spec !== '') extras.spec = spec
        if (category !== '') extras.category = category
        if (minStock !== null) extras.min_stock = minStock
        if (existing) {
          productService.update(existing.id, {
            name,
            base_unit: baseUnit,
            retail_price: retail,
            trade_price: trade,
            purchase_price: purchase,
            tracking_type: tracking,
            ...extras,
            barcodes: barcodeList
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
            barcodes: barcodeList,
            ...extras
          })
          result.created++
        }
      } catch (e) {
        result.errors.push({ row: rowNo, message: String((e as Error)?.message ?? e) })
      }
    }
    return result
  }

  function previewOpeningStock(csvText: string): OpeningStockPreview {
    const rows = parseCsv(csvText)
    const result: OpeningStockPreview = { lines: [], errors: [] }
    const findProduct = db.prepare('SELECT id, name FROM product WHERE code = ?')
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1
      const cols = rows[i] ?? []
      try {
        const code = (cols[0] ?? '').trim()
        if (code === '') throw new Error('商品编码不能为空')
        const p = findProduct.get(code) as { id: number; name: string } | undefined
        if (!p) throw new Error(`商品不存在：${code}`)
        const qty = toNum(cols[1], '数量')
        if (qty === undefined) throw new Error('数量不能为空且必须是数字')
        if (qty === 0) throw new BizError('VALIDATION', '数量必须大于 0')
        const cost = toNum(cols[2], '成本单价') ?? 0
        const batch = (cols[3] ?? '').trim()
        result.lines.push({ row: rowNo, product_id: p.id, product_code: code, product_name: p.name, batch_no: batch, qty, unit_cost: cost })
      } catch (e) {
        result.errors.push({ row: rowNo, message: String((e as Error)?.message ?? e) })
      }
    }
    return result
  }

  function importOpeningStock(csvText: string, warehouseId: number): ImportResult {
    const { lines, errors } = previewOpeningStock(csvText)
    const result: ImportResult = { created: 0, updated: 0, errors }
    if (lines.length === 0) return result
    try {
      inventoryService.applyChanges(
        lines.map((c) => ({
          product_id: c.product_id,
          warehouse_id: warehouseId,
          batch_no: c.batch_no,
          change_qty: c.qty,
          unit_cost: c.unit_cost,
          source: 'import'
        }))
      )
      result.created = lines.length
    } catch (e) {
      // 整批事务失败（如仓库不存在）时按行无法定位，报首行
      result.errors.push({ row: lines[0]!.row, message: String((e as Error)?.message ?? e) })
    }
    return result
  }

  return { importProducts, previewProducts, importOpeningStock, previewOpeningStock }
}

export type ImportService = ReturnType<typeof createImportService>
