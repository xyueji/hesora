// CSV 导入导出 API：文件写入在 main（保存对话框），文件内容由渲染层 FileReader 读取后传入。
import type { Result } from '../../../shared/result'

export interface ImportResult {
  created: number
  updated: number
  errors: Array<{ row: number; message: string }>
}

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export type CsvExportKind = 'products' | 'customers' | 'suppliers' | 'stock' | 'purchase' | 'sale'

export interface CsvExportParams {
  warehouse_id?: number
  date_from?: string
  date_to?: string
}

/** 读取用户选择的文件内容（渲染层 input[type=file]，不碰 fs）。 */
export function readCsvFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file, 'utf-8')
  })
}

export const csvApi = {
  /** 导出 CSV：弹出保存对话框，返回保存路径；用户取消时抛"已取消导出"。 */
  export: (kind: CsvExportKind, params?: CsvExportParams) =>
    call<string>('csv:export', { kind, params: params ?? {} }),
  importProducts: (fileContent: string) =>
    call<ImportResult>('csv:importProducts', { fileContent }),
  importOpeningStock: (fileContent: string, warehouseId: number) =>
    call<ImportResult>('csv:importOpeningStock', { fileContent, warehouse_id: warehouseId })
}
