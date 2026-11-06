// 打印 API：小票静默打印 / A4 导出 PDF。
import type { Result } from '../../../shared/result'

interface WinApi {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

const api = (window as unknown as { api: WinApi }).api

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const r = (await api.invoke(channel, payload)) as Result<T>
  if (!r.ok) throw new Error(r.msg || r.code)
  return r.data as T
}

export const printApi = {
  /** 打印热敏小票；deviceName 省略时使用系统默认打印机。 */
  receipt: (docId: number, deviceName?: string) =>
    call<boolean>('print:receipt', { docId, deviceName }),
  /** A4 打印（printToPDF + 保存对话框），返回保存路径。 */
  a4Pdf: (docId: number) => call<string>('print:a4pdf', docId)
}
