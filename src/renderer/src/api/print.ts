// 打印 API：小票静默打印 / A4 导出 PDF / 打印模板管理。
import { call } from './call'

/** 打印模板（content 为 JSON 字符串，字段开关见 shared/print/templates 的 PrintTemplateOptions）。 */
export interface PrintTemplate {
  id: number
  name: string
  kind: 'receipt' | 'a4'
  content: string
  is_default: number
  /** P2：绑定打印机设备名（打印时优先使用） */
  device_name?: string | null
}

export const printApi = {
  /** 打印热敏小票；deviceName 省略时使用系统默认打印机。 */
  receipt: (docId: number, deviceName?: string) =>
    call<boolean>('print:receipt', { docId, deviceName }),
  /** A4 打印（printToPDF + 保存对话框），返回保存路径。 */
  a4Pdf: (docId: number) => call<string>('print:a4pdf', docId)
}

export const printTemplateApi = {
  list: () => call<PrintTemplate[]>('printTemplate:list'),
  save: (p: { id?: number; name: string; kind: 'receipt' | 'a4'; content: string; device_name?: string | null }) =>
    call<number>('printTemplate:save', p),
  remove: (id: number) => call<void>('printTemplate:remove', id),
  setDefault: (id: number) => call<void>('printTemplate:setDefault', id)
}
