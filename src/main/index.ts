import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { ensureProfileDir, resolveProfilePath } from './db/profile'
import { seedDemoData, resetDemoData } from './db/seed'
import { isTrialExpiredWrite } from '../shared/license'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { buildAllHandlers, canViewDocument, type HandlerDeps } from './ipc/handlers'
import { PERMISSION_MAP } from './permissions-map'
import { can, getCurrentUser } from './auth'
import { createDesktopLicenseService } from './license'
import { applyPendingRestore } from './services/backup/backup.service'
import { createAuditService } from './services/audit/audit.service'
import { BizError } from '../shared/result'
import { createDocService } from './services/doc/doc.service'
import { createPrintIpc } from './print'
import { createCsvIpc } from './csv'
import { createBackupIpc } from './backup'
import { registerUpdateIpc } from './update'

const demoMode = app.commandLine.hasSwitch('demo')
if (demoMode) {
  const root = app.commandLine.hasSwitch('user-data-dir') ? app.getPath('userData') : app.getPath('appData')
  app.setPath('userData', ensureProfileDir(join(root, 'hesora-inventory-demo')))
} else if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', ensureProfileDir(resolveProfilePath(app.getPath('appData'))))
}
if (process.platform === 'win32') app.setAppUserModelId('com.hesora.inventory')

// Migrations dir: in dev the source tree exists, so resolve from app path.
// After packaging (Task 11), copy src/main/db/migrations into resources and use process.resourcesPath.
// app.getPath('userData') instead of app.userData: tsconfig.node.json sets types:["node"],
// which suppresses electron's ambient declarations for the App interface.
const migrationsDir = app.isPackaged
  ? join(process.resourcesPath, 'migrations')
  : join(app.getAppPath(), 'src/main/db/migrations')

let database: DB | undefined
function getDb(): DB {
  if (!database) {
    const file = resolveDatabasePath(app.getPath('userData'))
    applyPendingRestore(file)
    database = openDb(file, migrationsDir)
    if (demoMode) seedDemoData(database)
  }
  return database
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    title: '禾序进销存',
    backgroundColor: '#F5F7F3',
    icon: app.isPackaged ? join(process.resourcesPath, 'hesora.png') : join(app.getAppPath(), 'resources/hesora.png'),
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (demoMode) url.searchParams.set('mode', 'demo')
    void mainWindow.loadURL(url.toString())
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), demoMode ? { query: { mode: 'demo' } } : undefined)
  }

  return mainWindow
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  void app.whenReady().then(initialize).catch((error: unknown) => {
    dialog.showErrorBox('禾序进销存无法启动', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

function initialize(): void {
  // 试用到期守卫：trial 且 daysLeft<=0 时，除 auth:*/license:* 外一律拒绝
  const licenseSvc = createDesktopLicenseService(getDb())
  licenseSvc.getStatus()
  const auditSvc = createAuditService(getDb())
  // 敏感操作审计：危险/敏感通道在执行后写 platform_log（AGENTS.md §5 红线要求）。
  const operator = () => getCurrentUser()?.username
  const audit = (action: string, detail: string, before?: unknown, after?: unknown): void => {
    auditSvc.record(
      action,
      operator(),
      detail,
      before === undefined ? undefined : JSON.stringify(before),
      after === undefined ? undefined : JSON.stringify(after)
    )
  }
  const prevGuard = (channel: string): boolean => {
    const perm = PERMISSION_MAP[channel]
    return perm !== undefined && can(perm)
  }
  setDefaultPermissionGuard((channel) => {
    if (channel.startsWith('auth:') || channel.startsWith('license:') || channel.startsWith('trial:') || channel.startsWith('update:')) return true
    if (!prevGuard(channel)) return false
    const status = licenseSvc.getStatus()
    // 新试用策略：expired（超 14 天未激活）→ 只读模式，拦截业务单据写通道；
    // isTrialExpiredWrite 内部放行 license:/trial:/backup:/sync:/csv:/auth:/update: 白名单。
    if (isTrialExpiredWrite(channel, status.phase, status.daysLeft)) {
      audit('trial.blocked', `试用到期只读拦截通道: ${channel}`)
      return false
    }
    // 兼容旧守卫：未激活且无剩余天数（异常状态兜底）拒绝
    if (status.mode === 'trial' && status.daysLeft !== undefined && status.daysLeft <= 0 && status.phase === 'expired') {
      // phase=expired 已由 isTrialExpiredWrite 按白名单/拦截清单精判，此处不再一刀切
      return true
    }
    return true
  })
  // v1.3 Task 2: 可路由 handler 已抽取到 src/main/ipc/handlers.ts，
  // 由 buildAllHandlers(deps) 返回 { channel, handler } 表后统一注册；
  // print/csv/backup/sync/update 四组留在下方本地注册（涉及 dialog/BrowserWindow/更新器）。
  const handlerDeps: HandlerDeps = {
    getDb,
    productImagesDir: () => join(app.getPath('userData'), 'product-images'),
    attachmentsDir: () => join(app.getPath('userData'), 'attachments'),
    resetDemoData,
    licenseSvc: () => licenseSvc,
    auditSvc: () => auditSvc
  }
  for (const { channel, handler } of buildAllHandlers(handlerDeps)) {
    registerIpc({ [channel]: handler })
  }

  // print:a4pdf 权限判定：复用 handlers.ts 导出的 canViewDocument（单一事实来源）
  function assertDocumentVisible(id: number): void {
    const doc = createDocService(getDb()).getById(id)
    if (!doc || !canViewDocument(doc.type)) throw new BizError('NO_PERMISSION', '当前操作员没有权限查看此单据')
  }

  // P3：打印（print:receipt/print:a4pdf 依赖 BrowserWindow/dialog，留本地）
  const printIpc = createPrintIpc(getDb())
  registerIpc({
    'print:receipt': (_evt, payload) => {
      const { docId, deviceName, widthMm } = payload as { docId: number; deviceName?: string; widthMm?: 58 | 80 }
      return printIpc.printReceipt(Number(docId), deviceName, widthMm)
    },
    'print:a4pdf': (_evt, payload) => {
      const id = Number(payload)
      assertDocumentVisible(id)
      return printIpc.printA4Pdf(id)
    }
  })

  const csvIpc = createCsvIpc(getDb())
  registerIpc({
    'csv:export': async (_evt, payload) => {
      const { kind, params } = payload as { kind: string; params?: Record<string, unknown> }
      const operator = getCurrentUser()?.username
      const file = await csvIpc.exportCsv(kind as never, (params ?? {}) as never)
      if (file) auditSvc.record('data.export', operator, kind)
      return file
    },
    'csv:importProducts': (_evt, payload) => {
      const { fileContent, mode } = payload as { fileContent: string; mode?: 'skip' | 'update' }
      return csvIpc.importProducts(String(fileContent), mode === 'skip' ? 'skip' : 'update')
    },
    'csv:previewProducts': (_evt, payload) => {
      const { fileContent } = payload as { fileContent: string }
      return csvIpc.previewProducts(String(fileContent))
    },
    'csv:importOpeningStock': (_evt, payload) => {
      const { fileContent, warehouse_id } = payload as { fileContent: string; warehouse_id: number }
      return csvIpc.importOpeningStock(String(fileContent), Number(warehouse_id))
    },
    'csv:previewOpeningStock': (_evt, payload) => {
      const { fileContent } = payload as { fileContent: string }
      return csvIpc.previewOpeningStock(String(fileContent))
    }
  })

  const backupIpc = createBackupIpc(getDb(), migrationsDir)
  backupIpc.autoBackup()
  registerIpc({
    'backup:now': () => backupIpc.backupNow(),
    'backup:pickDir': () => backupIpc.pickDir(),
    'backup:list': () => backupIpc.backupList(),
    'backup:restore': (_evt, payload) => {
      const file = String(payload)
      const result = backupIpc.restoreBackup(file)
      audit('backup:restore', file)
      return result
    },
    'sync:getConfig': () => backupIpc.syncGetConfig(),
    'sync:saveConfig': (_evt, payload) => backupIpc.syncSaveConfig(payload),
    'sync:now': () => backupIpc.syncNow(),
    'sync:download': (_evt, source) => {
      if (source !== undefined && source !== 'local' && source !== 'webdav') throw new BizError('VALIDATION', '同步目标无效')
      return backupIpc.syncDownload(source)
    },
    'sync:checkTargets': () => backupIpc.syncCheckTargets(),
    'sync:cancelRestore': (_evt, payload) => backupIpc.cancelSyncRestore(String(payload)),
    'sync:restoreFromCloud': (_evt, payload) => {
      const { token, acceptLocalChanges } = payload as { token: string; acceptLocalChanges: boolean }
      return backupIpc.restoreFromCloud(String(token), acceptLocalChanges === true)
    }
  })

  // 提示式更新（无需权限，登录前也可检查）
  registerUpdateIpc()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
