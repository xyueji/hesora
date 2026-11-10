import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { ensureProfileDir, resolveProfilePath } from './db/profile'
import { seedDemoData, resetDemoData } from './db/seed'
import { isTrialExpiredWrite, hasFeature } from '../shared/license'
import { assertMaxDevices } from './services/license-gate'
import { ALL_PERMISSIONS, ROLE_PRESETS } from '../shared/permissions'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { createHostPairIpc, shouldCreateTray } from './ipc/host-pair-ipc'
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
// v1.3 Task 8: Tray 引用（仅 lanAllowed 创建；window-all-closed 隐藏语义 + before-quit 清理用）。
// B6（T8 双审）：window-all-closed 按 lanAllowed 判断（模块级，Tray 创建失败也不误退）。
let lanAllowedRef = false
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
    // v1.4 授权门控：激活后授权可变，惰性重读 license.code → verifyFormat。
    licensePayload: () => {
      const row = getDb().prepare("SELECT value FROM app_setting WHERE key='license.code'").pluck().get() as
        | string
        | undefined
      return row ? licenseSvc.verifyFormat(row) : null
    },
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
  // 设备 secret 内存表。T8 裁定：启动时从 secret-store（DPAPI/safeStorage）载入已持久化
  // secret，不可用则保持 T5 行为（重启后设备重新配对），只记日志。配对确认成功后写回。
  const deviceSecrets = new Map<string, string>()
  const deviceSecretLookup = (deviceId: string): string | null => deviceSecrets.get(deviceId) ?? null
  void (async () => {
    try {
      const { loadDeviceSecrets, isSecretPersistenceAvailable } = await import('./host/secret-store')
      const { safeStorage } = await import('electron')
      const deps = { userDataDir: app.getPath('userData'), safeStorage }
      if (isSecretPersistenceAvailable(deps)) {
        for (const [deviceId, secretHex] of loadDeviceSecrets(deps)) deviceSecrets.set(deviceId, secretHex)
        console.log(`[host] loaded ${deviceSecrets.size} persisted device secret(s)`)
      } else {
        console.warn('[host] safeStorage unavailable — device secrets not persisted this session')
      }
    } catch (e) {
      console.warn('[host] device secret load failed (re-pair after restart):', e)
    }
  })()


  // 双条件才启动：①授权含 lan_collaboration feature ②用户已开启 host_lan_enabled（默认 off）。
  // fastify 等重依赖只在满足条件时动态 import——无 feature 时零开销（T10 验收点）。
  type HostServerHandleLike = {
    port: number
    close(): Promise<void>
    listen(): Promise<number>
    onConnection(cb: (ws: unknown, req: import('node:http').IncomingMessage) => void): void
    /** T8 双审 A2/A3：/pair/result 登记与按设备踢连接（server.ts 5.x 新增）。 */
    setPairResult?(code: string, result: { status: 'pending' | 'granted' | 'denied'; deviceId?: string; secretHex?: string; deviceName?: string }): void
    /** T9：HTTP /pair/start 到达回调（同步进 host:pairPending 列表）。 */
    setPairRequestCb?(cb: (entry: { code: string; deviceName: string; expiresAt: number }) => void): void
    disconnectDevice?(deviceId: string, closeCode?: number): number
  }
  let hostServer: HostServerHandleLike | null = null
  // v1.3 Task 8: pairing 实例提升到模块级闭包（host:* IPC 需在主机 IIFE 外可调）。
  let pairingRef: import('./host/pairing').PairingService | null = null
  const licenseCodeRow = getDb().prepare("SELECT value FROM app_setting WHERE key='license.code'").pluck().get() as
    | string
    | undefined
  // verifyFormat 是 licenseSvc 的公开方法（parseCode 的包装），返回 payload|null。
  const licensePayload = licenseCodeRow ? licenseSvc.verifyFormat(licenseCodeRow) : null
  // v1.4 maxDevices：pairGrant 前检查未吊销设备数是否已达授权上限（activation 之后授权可变，惰性重读）。
  const assertDeviceLimit = (): void => {
    const row = getDb().prepare("SELECT value FROM app_setting WHERE key='license.code'").pluck().get() as
      | string
      | undefined
    const payload = row ? licenseSvc.verifyFormat(row) : null
    const count = (getDb().prepare('SELECT COUNT(*) AS c FROM host_devices WHERE revoked_at IS NULL').get() as { c: number }).c
    assertMaxDevices(payload, count)
  }
  const lanEnabledRow = getDb().prepare("SELECT value FROM app_setting WHERE key='host_lan_enabled'").pluck().get() as
    | string
    | undefined
  // v1.3 Task 8: Tray 门控复用的组合布尔（原 if 条件追加提炼，语义不变）。
  const lanAllowed =
    hasFeature(licensePayload, 'lan_collaboration') && lanEnabledRow === '1'
  lanAllowedRef = lanAllowed
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
      const { createEventHub } = await import('./host/events')
      const { setHostEventSink } = await import('./host/event-bus')
      const cert = await ensureHostCertificate(join(app.getPath('userData'), 'host-cert'))
      const handlers = new Map(buildAllHandlers(handlerDeps).map((h) => [h.channel, h]))
      const gw = createGateway({ getDb, handlers: handlers as never })
      const pairing = createPairingService(getDb() as never)
      pairingRef = pairing
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
        sessionLogin: (username, password) => {
          const userSvc = createUserService(getDb())
          const user = userSvc.verify(username, password)
          if (!user) return null
          // 权限键集：admin 全量；自定义角色按 access_role.permissions；内置 cashier 走预设。
          const permissions =
            user.role === 'admin'
              ? [...ALL_PERMISSIONS]
              : user.permissions ?? [...ROLE_PRESETS.cashier]
          return { user: { id: user.id, username: user.username, role: user.role, roleName: user.roleName, permissions }, permissions }
        },
        log: (level, msg) => console.log(`[host:${level}] ${msg}`)
      })
      // T9：HTTP /pair/start 到达 → 同步进 host:pairPending 列表（UI 确认卡片可见）。
      // hostPairIpc 尚未创建（在其下方），用延迟桥接：把 HTTP 端的待确认码暂存，
      // hostPairIpc 创建后接管（见 createHostPairIpc deps.onHttpPairRequest）。
      hostServer.setPairRequestCb?.((entry) => {
        void import('./ipc/host-pair-ipc').then((m) => m.noteHttpPairRequest(entry))
      })
      await hostServer.listen().catch((e: unknown) => {
        console.error('[host] listen failed:', e)
        hostServer = null
      })
      // ── v1.3 Task 8: WS 事件 hub 接线 ──
      // spec §4.2：token 经 URL query ?token= 传入（首消息 {type:'auth',token} 兜底裁定见 spec 勘误节——
      // 本实现采用 query 单通道，无效即 close(4001)，不做首消息兜底以减少半认证窗口）。
      // 防双 ping 裁定：hub 侧 25s JSON ping 是唯一心跳；server.ts 无任何 ping（见 spec 勘误节）。
      if (hostServer) {
        const hub = createEventHub({ log: (msg) => console.log(`[hub] ${msg}`) })
        // T8 双审 A3：hub 踢连接实现桥接进 hostServer（吊销设备 revokeDevice → kickDevice）。
        ;(hostServer as { installKick?: (f: (deviceId: string, closeCode?: number) => number) => void }).installKick?.(
          (deviceId, closeCode) => hub.disconnectDevice(deviceId, closeCode)
        )
        // 业务事件 → hub.broadcast → 已订阅且有权重的 WS 客户端
        setHostEventSink((event) => hub.broadcast(event))
        const urlOf = (req: { url?: string }): string => req.url ?? ''
        const tokenOfUrl = (u: string): string | null => {
          try {
            const q = new URL(u, 'https://local').searchParams
            return q.get('token')
          } catch {
            return null
          }
        }
        // 连接数变化 → 渲染端 lan:state-changed。
        // T8 双审勘误（C1/I1）：payload 为布尔 connected（与 preload/App.vue 契约一致），
        // 且按真实状态发送：连接成功 true，连接关闭后 hub 无连接则 false。
        const notifyLanState = (connected: boolean): void => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('lan:state-changed', connected)
          }
        }
        hostServer.onConnection((ws: unknown, req: import("node:http").IncomingMessage) => {
          const u = urlOf(req)
          // upgrade 路径过滤：仅 /events 进 hub；其他 upgrade 路径一律关闭
          if (!(u === '/events' || u.startsWith('/events?') || u.startsWith('/events/'))) {
            try { (ws as { close: () => void }).close() } catch { /* ignore */ }
            return
          }
          const token = tokenOfUrl(u)
          const session = token ? hostAuth.validateSession(token) : null
          if (!session) {
            try { (ws as { close: (code?: number) => void }).close(4001) } catch { /* ignore */ }
            return
          }
          hub.registerConnection(
            ws as never,
            { deviceId: session.deviceId, userId: session.userId },
            (userId, key) => canFor(userId, key)
          )
          notifyLanState(true)
          ;(ws as { on: (ev: string, cb: () => void) => void }).on('close', () => notifyLanState(hub.connectionCount() > 0))
        })
      }
      // 配对确认 UI 已接（v1.3 Task 8）：客户端 POST /pair/start 产生的码经 host:pairPending
      // 轮询进主窗口确认卡片（/host/connect），[允许]→host:pairGrant 写三处 secret。
      console.log('[host] LAN 协作主机已启动（配对确认 UI 已接：/host/connect 确认卡片）')
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

  // ── v1.3 Task 8: 主机端 host:* IPC（配对确认/设备管理/状态） ──
  // 逻辑层抽在 ipc/host-pair-ipc.ts（可测）；此处接线 main 侧真实依赖。
  const hostPairIpc = createHostPairIpc({
    getPairing: () => pairingRef,
    getServerInfo: () => (hostServer ? { port: hostServer.port } : null),
    deviceSecrets,
    secretStoreDeps: null, // initialize 下方 IIFE 异步填充（safeStorage 动态 import）
    saveDeviceSecret: (d, id, hex) => {
      // 异步写 DPAPI（失败仅影响持久化，不影响内存表两处写入）。
      void import('./host/secret-store').then((m) => m.saveDeviceSecret(d, id, hex))
    },
    removeDeviceSecret: (d, id) => {
      void import('./host/secret-store').then((m) => m.removeDeviceSecret(d, id))
    },
    lanAllowed: () => lanAllowed,
    // v1.4 maxDevices 门控：配对确认落库前拒绝超上限设备。
    assertDeviceLimit,
    kickDevice: (deviceId) => {
      try {
        hostServer?.disconnectDevice?.(deviceId)
      } catch {
        // 踢连接失败不影响吊销结果。
      }
    }
  })
  // DPAPI deps 异步补齐（safeStorage 只能动态 import；secret-store 模块本身禁顶层 electron）。
  void (async () => {
    try {
      const { safeStorage } = await import('electron')
      hostPairIpc.setSecretStoreDeps({ userDataDir: app.getPath('userData'), safeStorage })
    } catch {
      // safeStorage 不可用→secret 只进内存（重启后重新配对），不阻断 IPC。
    }
  })()
  // host:* 通道：admin only（host 属本机管理功能，不进 PERMISSION_MAP 走角色直判）。
  registerIpc(
    {
      'host:pairStart': (_evt, payload) => {
        const { deviceName } = (payload ?? {}) as { deviceName?: unknown }
        return hostPairIpc.pairStart(deviceName)
      },
      'host:pairPending': () => hostPairIpc.pairPending(),
      'host:pairGrant': (_evt, payload) => {
        const { code } = (payload ?? {}) as { code?: unknown }
        const r = hostPairIpc.pairGrant(code)
        // T8 双审 A2：/pair/result 轮询结果登记（granted + secret 一次性下发）。
        if (r.ok && typeof code === 'string' && hostServer?.setPairResult) {
          const { deviceId } = r.data as { deviceId: string }
          const secretHex = deviceSecrets.get(deviceId)
          hostServer.setPairResult(code.trim(), { status: 'granted', deviceId, secretHex })
        }
        return r
      },
      'host:pairDeny': (_evt, payload) => {
        const { code } = (payload ?? {}) as { code?: unknown }
        const r = hostPairIpc.pairDeny(code)
        // T8 双审 A2：deny 后 /pair/result 轮询返回 denied。
        if (r.ok && typeof code === 'string' && hostServer?.setPairResult) {
          hostServer.setPairResult(code.trim(), { status: 'denied' })
        }
        return r
      },
      'host:listDevices': () => hostPairIpc.listDevices(),
      'host:revokeDevice': (_evt, payload) => {
        const { deviceId } = (payload ?? {}) as { deviceId?: unknown }
        return hostPairIpc.revokeDevice(deviceId)
      },
      'host:status': () => hostPairIpc.status()
    },
    () => getCurrentUser()?.role === 'admin'
  )

  // ── v1.3 Task 8: Tray（仅 lanAllowed 创建，D4） ──
  if (shouldCreateTray(lanAllowed)) {
    void (async () => {
      try {
        const { Tray, Menu, nativeImage } = await import('electron')
        const iconPath = app.isPackaged
          ? join(process.resourcesPath, 'hesora.png')
          : join(app.getAppPath(), 'resources/hesora.png')
        const tray = new Tray(nativeImage.createFromPath(iconPath))
        const rebuildMenu = (): void => {
          const deviceCount = pairingRef
            ? pairingRef.listDevices().filter((d) => d.revoked_at === null).length
            : 0
          tray.setContextMenu(
            Menu.buildFromTemplate([
              { label: hostServer ? '主机状态：运行中 (18650)' : '主机状态：未运行', enabled: false },
              { label: `已连接设备：${deviceCount}`, enabled: false },
              { type: 'separator' },
              {
                label: '打开主窗口',
                click: () => {
                  const win = BrowserWindow.getAllWindows()[0]
                  if (win) {
                    win.show()
                    win.focus()
                  } else {
                    createWindow()
                  }
                }
              },
              {
                label: '退出',
                click: () => {
                  // 彻底退出：先关 hostServer、清 Tray，再 app.exit（绕过 window-all-closed 隐藏逻辑）。
                  void (async () => {
                    try {
                      if (hostServerRef) await hostServerRef.close()
                    } catch { /* ignore */ }
                    try {
                      const { setHostEventSink } = await import('./host/event-bus')
                      setHostEventSink(null)
                    } catch { /* ignore */ }
                    tray.destroy()
                    app.exit(0)
                  })()
                }
              }
            ])
          )
        }
        rebuildMenu()
        // 设备数随配对/吊销变化：定时刷新菜单（3 台设备规模，30s 足够）。
        const trayTimer = setInterval(rebuildMenu, 30_000)
        trayTimer.unref?.()
        tray.on('click', () => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            win.show()
            win.focus()
          } else {
            createWindow()
          }
        })
      } catch (e) {
        console.warn('[tray] create failed:', e)
      }
    })()
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  // v1.3 Task 5: 退出时关闭 LAN 主机服务（若已启动）。
  // T8 双审勘误（I5）：退出时摘除主机事件 sink，防止退出途中再向已关闭的 hub 广播；
  // pending 幂等登记 flush 留 TODO——pending-registry 目前在 lan-client（T9 客户端接线）
  // 中实例化，本任务未实例化故无可 flush 对象。
  void (async () => {
    try {
      const { setHostEventSink } = await import('./host/event-bus')
      setHostEventSink(null)
    } catch { /* ignore */ }
  })()
  // TODO(T9): lan-client + PendingRegistry 在客户端接线时实例化，届时在此 flush()
  if (hostServerRef) {
    hostServerRef.close().catch(() => {})
  }
  if (process.platform !== 'darwin') {
    // v1.3 Task 8 + T8 双审 B6：按 lanAllowed（license feature + 用户开关）判断，
    // 而非 trayRef——Tray 创建失败（如无图标）时窗口全关也不应 quit，主机留在后台持续可连。
    if (lanAllowedRef) return
    app.quit()
  }
})
