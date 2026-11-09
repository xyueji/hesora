// 打印 IPC 通道（薄 Electron 层）：小票静默打印 + A4 printToPDF。
// 数据与 HTML 生成来自纯模块 print.service / shared/print/templates，本文件只做窗口与打印调用。
import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import type { Database } from 'better-sqlite3'
import { BizError } from '../shared/result'
import { createPrintService } from './services/print/print.service'
import { createPrintTemplateService } from './services/print/template.service'
import { renderA4Html, renderReceiptHtml, type PrintTemplateOptions } from '../shared/print/templates'

/** 读默认模板的开关与绑定设备；无模板或 content 无效时回退 undefined（= 现状硬编码行为）。 */
function templateOptionsOf(db: Database, kind: 'receipt' | 'a4'): { options?: PrintTemplateOptions; deviceName?: string | null } {
  try {
    const tpl = createPrintTemplateService(db).getDefault(kind)
    if (!tpl) return {}
    const parsed: unknown = JSON.parse(tpl.content)
    const options =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as PrintTemplateOptions)
        : undefined
    return { options, deviceName: tpl.device_name ?? null }
  } catch {
    /* 回退现状行为 */
  }
  return {}
}

export function createPrintIpc(db: Database) {
  const printService = createPrintService(db)

  /** 隐藏窗口加载 HTML，回调里执行打印，完成后关闭。 */
  async function withHiddenWindow<T>(html: string, use: (wc: Electron.WebContents) => Promise<T>): Promise<T> {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      return await use(win.webContents)
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  }

  async function printReceipt(docId: number, deviceName?: string, widthMm?: 58 | 80): Promise<boolean> {
    const { options, deviceName: boundDevice } = templateOptionsOf(db, 'receipt')
    const html = renderReceiptHtml(printService.receiptData(docId, widthMm), options)
    // 设备优先级：调用方显式指定 > 模板绑定设备
    const targetDevice = deviceName?.trim() ? deviceName.trim() : boundDevice ?? undefined
    await withHiddenWindow(html, (wc) => new Promise<void>((resolve, reject) => {
      wc.print({
        silent: true,
        printBackground: true,
        margins: { marginType: 'none' },
        ...(targetDevice ? { deviceName: targetDevice } : {})
      }, (success, reason) => {
        if (success) resolve()
        else reject(new BizError('PRINT_FAILED', reason ? `小票打印失败：${reason}` : '小票打印失败，请检查打印机连接和纸张'))
      })
    }))
    return true
  }

  async function printA4Pdf(docId: number): Promise<string> {
    const html = renderA4Html(printService.a4Data(docId), templateOptionsOf(db, 'a4').options)
    const pdf = await withHiddenWindow(html, (wc) =>
      wc.printToPDF({ printBackground: true, pageSize: 'A4' })
    )
    if (!pdf || pdf.length === 0) {
      throw new BizError('PRINT_FAILED', '生成 PDF 失败')
    }
    const r = await dialog.showSaveDialog({
      title: '保存打印文件',
      defaultPath: `打印-${docId}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) {
      throw new BizError('CANCELLED', '已取消保存')
    }
    writeFileSync(r.filePath, pdf)
    return r.filePath
  }

  return { printReceipt, printA4Pdf }
}

export type PrintIpc = ReturnType<typeof createPrintIpc>
