import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { ensureProfileDir, resolveProfilePath } from './db/profile'
import { seedDemoData, resetDemoData } from './db/seed'
import { isTrialExpiredWrite, hasFeature } from '../shared/license'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { buildAllHandlers, canViewDocument, type HandlerDeps } from './ipc/handlers'
import { PERMISSION_MAP } from './permissions-map'
import { can, getCurrentUser, installUserLookup, canFor } from './auth'
import { createIdempotencyStore } from './host/idempotency'
import { createUserService } from './services/user/user.service'
import { createDesktopLicenseService } from './license'
import { applyPendingRestore } from './services/backup/backup.service'
import { createAuditService } from './services/audit/audit.service'
import { BizError } from '../shared/result'

// v1.3 Task 5: LAN 主机服务退出关闭引用（initialize 内 IIFE 赋值，window-all-closed 消费）。
let hostServerRef: { close(): Promise<void> } | null = null
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

  // v1.3 Task 3: userId→SessionUser 查找接线（LAN 网关 canFor 依赖；防御性——userFor 内部
  // 已走 userSvc.sessionById，此处让 auth.canFor/getUserById 也基于库而非内存 currentUser）。
  installUserLookup((id) => createUserService(getDb()).sessionById(id))
  // 幂等防重放缓存清理：启动一次 + 每日一次（跟随 autoBackup 的启动钩子模式）。
  const idemStore = createIdempotencyStore(getDb())
  idemStore.cleanup()
  const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 24 * 3600 * 1000
  const idemCleanupTimer = setInterval(() => {
    try {
      idemStore.cleanup()
    } catch {
      // 清理失败不影响业务运行，下次定时重试。
    }
  }, IDEMPOTENCY_CLEANUP_INTERVAL_MS)
  idemCleanupTimer.unref?.()

  // ── v1.3 Task 5: LAN 协作主机服务懒加载接线 ──
  // 设备 secret 内存表（重启即空 → 设备重新配对，v1.3 简化裁定；T6 持久化议题）。
  const deviceSecrets = new Map<string, string>()
  const deviceSecretLookup = (deviceId: string): string | null => deviceSecrets.get(deviceId) ?? null


  // 双条件才启动：①授权含 lan_collaboration feature ②用户已开启 host_lan_enabled（默认 off）。
  // fastify 等重依赖只在满足条件时动态 import——无 feature 时零开销（T10 验收点）。
  type HostServerHandleLike = { port: number; close(): Promise<void>; listen(): Promise<number> }
  let hostServer: HostServerHandleLike | null = null
  const licenseCodeRow = getDb().prepare("SELECT value FROM app_setting WHERE key='license.code'").pluck().get() as
    | string
    | undefined
  // verifyFormat 是 licenseSvc 的公开方法（parseCode 的包装），返回 payload|null。
  const licensePayload = licenseCodeRow ? licenseSvc.verifyFormat(licenseCodeRow) : null
  const lanEnabledRow = getDb().prepare("SELECT value FROM app_setting WHERE key='host_lan_enabled'").pluck().get() as
    | string
    | undefined
  if (hasFeature(licensePayload, 'lan_collaboration') && lanEnabledRow === '1') {
    // initialize() 同步——异步启动放进 IIFE，失败只记日志不阻断主进程。
    void (async () => {
      try {
      // 动态 import：fastify/ws/@peculiar/x509 均在此懒加载。
      const { ensureHostCertificate } = await import('./host/cert')
      const { createHostServer } = await import('./host/server')
      const { createGateway } = await import('./host/gateway')
      const { createPairingService } = await import('./host/pairing')
      const { createHostAuthService } = await import('./host/auth')
      const cert = await ensureHostCertificate(join(app.getPath('userData'), 'host-cert'))
      const handlers = new Map(buildAllHandlers(handlerDeps).map((h) => [h.channel, h]))
      const gw = createGateway({ getDb, handlers: handlers as never })
      const pairing = createPairingService(getDb() as never)
      const hostAuth = createHostAuthService(getDb() as never)
      hostServer = await createHostServer({
        getDb,
        handlers: handlers as never,
        pairing,
        hostAuth,
        gateway: gw,
        canFor: (userId, key) => canFor(userId, key),
        tls: { keyPem: cert.keyPem, certPem: cert.certPem },
        port: 18650,
        getDeviceSecret: deviceSecretLookup,
        log: (level, msg) => console.log(`[host:${level}] ${msg}`)
      })
      await hostServer.listen().catch((e: unknown) => {
        console.error('[host] listen failed:', e)
        hostServer = null
      })
      // 配对确认：host 侧需要物理确认——UI 弹窗属 T8，本任务 console/通知占位。
      // T8 接管点：轮询 pairing 待确认请求或事件推送，弹窗确认后调
      // pairing.confirmPairing(code) → deviceSecrets.set(deviceId, secret.toString('hex'))。
      console.log('[host] LAN 协作主机已启动（配对确认 UI 待 T8 接入）')
        hostServerRef = hostServer
      } catch (e) {
        // 主机服务启动失败不阻断主进程业务（本机单机模式仍完整可用）。
        console.error('[host] LAN host server init failed:', e)
        hostServer = null
      }
    })()
  }
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
  // v1.3 Task 5: 退出时关闭 LAN 主机服务（若已启动）。
  if (hostServerRef) {
    hostServerRef.close().catch(() => {})
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
