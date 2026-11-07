// 导出服务（纯）：把各域数据转成 CSV 文本。禁止 import electron / fs —— 文件写入在 main 的薄层。
import type { Database } from 'better-sqlite3'
import { buildCsv, OPENING_STOCK_IMPORT_COLUMNS, PRODUCT_IMPORT_COLUMNS } from '../../../shared/csv'
import type { DocType } from '../../../shared/types/doc'
import { createInventoryService } from '../inventory/inventory.service'
import { createDocService } from '../doc/doc.service'

export type DB = Database

interface ProductExportRow {
  code: string
  name: string
  base_unit: string
  retail_price: number
  trade_price: number
  purchase_price: number
  tracking_type: string
  kind: string
  disabled: number
  units: string | null
}

interface CustomerExportRow {
  code: string
  name: string
  contact: string | null
  phone: string | null
  address: string | null
  price_level: string | null
  opening_receivable: number
  credit_limit: number | null
  remark: string | null
  disabled: number
}

interface SupplierExportRow {
  code: string
  name: string
  contact: string | null
  phone: string | null
  address: string | null
  opening_payable: number
  remark: string | null
  disabled: number
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export function createExportService(db: DB) {
  function products(): string {
    const rows = db
      .prepare(`
        SELECT p.code, p.name, p.base_unit, p.retail_price, p.trade_price, p.purchase_price,
               p.tracking_type, p.kind, p.disabled,
               (
                 SELECT GROUP_CONCAT(u.unit || 'x' || RTRIM(RTRIM(CAST(u.rate AS TEXT), '0'), '.'), ';')
                 FROM product_unit u WHERE u.product_id = p.id AND u.is_base = 0
               ) AS units
        FROM product p ORDER BY p.id ASC
      `)
      .all() as ProductExportRow[]
    return buildCsv(
      [...PRODUCT_IMPORT_COLUMNS, '商品类型', '停用'],
      rows.map((r) => [
        r.code,
        r.name,
        r.base_unit,
        num(r.retail_price),
        num(r.trade_price),
        num(r.purchase_price),
        r.tracking_type,
        r.kind === 'combo' ? '组合商品' : '标准商品',
        r.disabled === 1 ? '是' : '否'
      ])
    )
  }

  function customers(): string {
    const rows = db
      .prepare('SELECT * FROM customer ORDER BY id ASC')
      .all() as CustomerExportRow[]
    return buildCsv(
      ['编码', '名称', '联系人', '电话', '地址', '价格等级', '期初应收', '信用额度', '备注', '停用'],
      rows.map((r) => [
        r.code,
        r.name,
        r.contact,
        r.phone,
        r.address,
        r.price_level,
        num(r.opening_receivable),
        r.credit_limit === null ? null : num(r.credit_limit),
        r.remark,
        r.disabled === 1 ? '是' : '否'
      ])
    )
  }

  function suppliers(): string {
    const rows = db
      .prepare('SELECT * FROM supplier ORDER BY id ASC')
      .all() as SupplierExportRow[]
    return buildCsv(
      ['编码', '名称', '联系人', '电话', '地址', '期初应付', '备注', '停用'],
      rows.map((r) => [
        r.code,
        r.name,
        r.contact,
        r.phone,
        r.address,
        num(r.opening_payable),
        r.remark,
        r.disabled === 1 ? '是' : '否'
      ])
    )
  }

  function stock(warehouseId?: number): string {
    const inv = createInventoryService(db)
    // 导出需要全量，pageSize 给足上限
    let total = Infinity
    const all: ReturnType<typeof inv.queryStock>['items'] = []
    let page = 1
    while (all.length < total) {
      const r = inv.queryStock({
        warehouse_id: warehouseId,
        page,
        pageSize: 200
      })
      total = r.total
      all.push(...r.items)
      if (r.items.length === 0) break
      page++
    }
    return buildCsv(
      ['商品编码', '商品名称', '规格', '单位', '仓库', '批次', '数量', '成本单价', '金额'],
      all.map((it) => [
        it.product_code,
        it.product_name,
        it.spec,
        it.unit,
        it.warehouse_name,
        it.batch_no,
        it.qty,
        it.moving_cost,
        it.amount
      ])
    )
  }

  function docs(type: DocType, dateFrom?: string, dateTo?: string): string {
    const docSvc = createDocService(db)
    // 分页取全量单据，再逐单取明细，一行 = 一个明细
    let total = Infinity
    const docIds: number[] = []
    let page = 1
    while (docIds.length < total) {
      const r = docSvc.query({ type, date_from: dateFrom, date_to: dateTo, page, pageSize: 200 })
      total = r.total
      docIds.push(...r.items.map((d) => d.id))
      if (r.items.length === 0) break
      page++
    }
    const rows: Array<Array<string | number | null>> = []
    for (const id of docIds) {
      const doc = docSvc.getById(id)
      if (!doc) continue
      for (const it of docSvc.getItems(id)) {
        const p = db
          .prepare('SELECT code, name, base_unit FROM product WHERE id = ?')
          .get(it.product_id) as { code: string; name: string; base_unit: string } | undefined
        rows.push([
          doc.no,
          doc.date,
          doc.type,
          p?.code ?? String(it.product_id),
          p?.name ?? '',
          it.unit || p?.base_unit || '',
          it.qty,
          it.price,
          it.amount
        ])
      }
    }
    return buildCsv(['单号', '日期', '类型', '商品编码', '商品名称', '单位', '数量', '单价', '金额'], rows)
  }

  function importTemplate(kind: 'products' | 'opening-stock'): string {
    return buildCsv(kind === 'products' ? PRODUCT_IMPORT_COLUMNS : OPENING_STOCK_IMPORT_COLUMNS, [])
  }

  return { products, customers, suppliers, stock, docs, importTemplate }
}

export type ExportService = ReturnType<typeof createExportService>
