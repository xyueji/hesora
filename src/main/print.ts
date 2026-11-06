// 打印 IPC 通道（薄 Electron 层）：小票静默打印 + A4 printToPDF。
// 数据与 HTML 生成来自纯模块 print.service / shared/print/templates，本文件只做窗口与打印调用。
import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import type { Database } from 'better-sqlite3'
import { BizError } from '../shared/result'
import { createPrintService } from './services/print/print.service'
import { renderA4Html, renderReceiptHtml } from '../shared/print/templates'

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

  async function printReceipt(docId: number, deviceName?: string): Promise<boolean> {
    const html = renderReceiptHtml(printService.receiptData(docId))
    // wc.print 返回 void（结果由 'did-fail-print' 等事件体现），静默模式按已发送处理。
    await withHiddenWindow(html, (wc) =>
      Promise.resolve(
        wc.print({
          silent: true,
          printBackground: true,
          ...(deviceName ? { deviceName } : {})
        })
      )
    )
    return true
  }

  async function printA4Pdf(docId: number): Promise<string> {
    const html = renderA4Html(printService.a4Data(docId))
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
