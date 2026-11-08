// CSV 导入导出 IPC（薄 Electron 层）：导出走保存对话框 + fs.writeFile；
// 导入的文件内容由渲染层用 FileReader 读取后经 IPC 传入（渲染层不碰磁盘）。
import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import type { Database } from 'better-sqlite3'
import { BizError } from '../shared/result'
import { createExportService } from './services/export/export.service'
import { createImportService, type ImportResult } from './services/import/import.service'
import type { DocType } from '../shared/types/doc'
import type { ReportQuery } from '../shared/types/report'
import { buildCsv } from '../shared/csv'
import { createReportService } from './services/stats/report.service'
import { createArrearsService } from './services/stats/arrears.service'

export type ExportKind = 'products' | 'customers' | 'suppliers' | 'stock' | 'purchase' | 'sale' | 'product-template' | 'opening-stock-template' | 'report' | 'aging'

export interface ExportParams {
  warehouse_id?: number
  date_from?: string
  date_to?: string
  report?: ReportQuery
  /** 账龄导出：customers | suppliers */
  agingSide?: 'customers' | 'suppliers'
  /** 账龄导出：截至日期（YYYY-MM-DD），缺省今天 */
  asOf?: string
}

export function createCsvIpc(db: Database) {
  const exportService = createExportService(db)
  const importService = createImportService(db)
  const reportService = createReportService(db)
  const arrearsService = createArrearsService(db)

  function defaultName(kind: string): string {
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${kind}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`
  }

  async function exportCsv(kind: ExportKind, params: ExportParams): Promise<string> {
    let csv: string
    switch (kind) {
      case 'products':
        csv = exportService.products()
        break
      case 'customers':
        csv = exportService.customers()
        break
      case 'suppliers':
        csv = exportService.suppliers()
        break
      case 'stock':
        csv = exportService.stock(params.warehouse_id)
        break
      case 'product-template':
      case 'opening-stock-template':
        csv = exportService.importTemplate(kind === 'product-template' ? 'products' : 'opening-stock')
        break
      case 'report':
        if (!params.report) throw new BizError('VALIDATION', '请选择要导出的报表')
        csv = reportService.exportCsv(params.report)
        break
      case 'aging': {
        const side = params.agingSide === 'suppliers' ? 'suppliers' : 'customers'
        const result = arrearsService.aging(params.asOf)
        const rows = side === 'customers' ? result.customers : result.suppliers
        csv = buildCsv(
          ['往来单位', '未结总额', '0-30天', '31-60天', '61-90天', '90天以上', '最早未结日期'],
          rows.map((r) => [r.partner_name, r.total.toFixed(2), r.b0_30.toFixed(2), r.b31_60.toFixed(2), r.b61_90.toFixed(2), r.b90plus.toFixed(2), r.oldest ?? ''])
        )
        break
      }
      case 'purchase':
      case 'sale':
        csv = exportService.docs(kind as DocType, params.date_from, params.date_to)
        break
      default:
        throw new BizError('VALIDATION', `未知的导出类型：${String(kind)}`)
    }
    const r = await dialog.showSaveDialog({
      title: '导出 CSV',
      defaultPath: defaultName(kind),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) {
      throw new BizError('CANCELLED', '已取消导出')
    }
    await writeFile(r.filePath, csv, 'utf8')
    return r.filePath
  }

  function importProducts(fileContent: string): ImportResult {
    return importService.importProducts(String(fileContent))
  }

  function importOpeningStock(fileContent: string, warehouseId: number): ImportResult {
    return importService.importOpeningStock(String(fileContent), Number(warehouseId))
  }

  return { exportCsv, importProducts, previewProducts: importService.previewProducts, importOpeningStock, previewOpeningStock: importService.previewOpeningStock }
}

export type CsvIpc = ReturnType<typeof createCsvIpc>
