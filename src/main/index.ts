import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { ensureProfileDir, resolveProfilePath } from './db/profile'
import { seedDemoData, resetDemoData } from './db/seed'
import { isTrialExpiredWrite, hasFeature } from '../shared/license'
import { matchesPrefix, LOCAL_CHANNEL_PREFIXES, HOST_ONLY_PREFIXES } from '../shared/channels'
import { assertMaxDevices, assertFeature } from './services/license-gate'
import { effectiveLicensePayload } from './services/license/trial-payload'
import { ALL_PERMISSIONS, ROLE_PRESETS } from '../shared/permissions'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { createHostPairIpc } from './ipc/host-pair-ipc'
import { buildAllHandlers, canViewDocument, type HandlerDeps } from './ipc/handlers'
import { PERMISSION_MAP } from './permissions-map'
import { can, getCurrentUser, installUserLookup, canFor } from './auth'
import { createIdempotencyStore } from './host/idempotency'
import { createUserService } from './services/user/user.service'
import { createDesktopLicenseService } from './license'
import { applyPendingRestore } from './services/backup/backup.service'
import { createAuditService } from './services/audit/audit.service'
import { BizError } from '../shared/result'
import { createClientConnection as createClientConnectionImpl } from './host/client-connection'
import { createSplashWindow, closeSplashWindow } from './splash'

// v1.3 Task 5: LAN 主机服务退出关闭引用（initialize 内 IIFE 赋值，window-all-closed 消费）。
let hostServerRef: { close(): Promise<void> } | null = null
// v1.3 Task 8: Tray 引用（仅 lanAllowed 创建；window-all-closed 隐藏语义 + before-quit 清理用）。
// B6（T8 双审）：window-all-closed 按 lanAllowed 判断（模块级，Tray 创建失败也不误退）。
let lanAllowedRef = false
// v1.4 客户端接线：本机作为 LAN 客户端（连接主机）的状态机引用。
// 用途：① 'lan:client*' IPC ② 'lan:client-state' 广播 ③ 退出时 flush 客户端 pending。
// 注意：主机侧没有 pending 实例（主机不产生待重试请求），退出 flush 只针对客户端。
let clientConnectionRef: import('./host/client-connection').ClientConnection | null = null
// v1.4：本机是否处于"客户端角色"（已配置主机）——业务通道禁止落本机库（防主机/客户端数据分叉）。
let clientModeActive = false
// v1.4：主机自签证书指纹（配对握手下发给客户端做 pinning）。
let hostFingerprintHexRef: string | null = null
// v1.4.1（用户 m06828）：系统托盘引用——改为无条件创建（关闭窗口=最小化到托盘，
// 托盘右键「退出」才真正退出）。托盘创建失败时为 null，关窗回退为直接退出。
let trayRef: import('electron').Tray | null = null
// 启动过渡页：app.whenReady() 后立即显示，主窗口 ready-to-show 或启动异常时关闭。
// 不参与单实例锁、不监听 window-all-closed，也不阻止 app.quit()。
let splashWindow: ReturnType<typeof createSplashWindow> | null = null
// 安全网：若主窗口因渲染进程异常迟迟不触发 ready-to-show，20s 后也强制关闭过渡页，
// 避免留下一个 alwaysOnTop + closable:false 的无法关闭置顶窗（质量预审 N-5）。
let splashSafetyTimer: ReturnType<typeof setTimeout> | null = null
function clearSplashSafety(): void {
  if (splashSafetyTimer) {
    clearTimeout(splashSafetyTimer)
    splashSafetyTimer = null
  }
}
function closeSplashSafely(): void {
  clearSplashSafety()
  closeSplashWindow(splashWindow)
  splashWindow = null
}
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
    // 主窗口已绘制：幂等关闭过渡页（重复触发 / 已销毁都安全）。
    closeSplashSafely()
  })

  // v1.4.1（用户 m06828）：点 X 关窗不退出——最小化到托盘（隐藏窗口），托盘右键「退出」才真正退出。
  // 依托上方无条件创建的系统托盘；LAN 主机/客户端断连的 pending flush 在真正退出路径（tray 退出 /
  // before-quit / window-all-closed）已有覆盖，隐藏不触发退出故无需额外处理。
  mainWindow.on('close', (event) => {
    if (trayRef) {
      event.preventDefault()
      mainWindow.hide()
    }
    // trayRef 为 null（托盘创建失败等异常环境）时保持原语义：正常关闭退出。
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
  void app.whenReady().then(() => {
    // 过渡页在任何 SQLite 打开 / migration / renderer 加载之前立即显示。
    splashWindow = createSplashWindow()
    // 20s 安全网：即使主窗口渲染异常未触发 ready-to-show，也不留下无法关闭的置顶窗。
    splashSafetyTimer = setTimeout(() => closeSplashSafely(), 20_000)
    initialize()
  }).catch((error: unknown) => {
    // 异常兜底：先关过渡页，避免残留窗口阻塞退出；随后 app.quit() 强制收尾。
    closeSplashSafely()
    dialog.showErrorBox('禾序进销存无法启动', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

function initialize(): void {
  // 试用到期守卫由 isTrialExpiredWrite 按 7 前缀白名单精判（到期仍允许 auth:/license:/backup:/sync: 等）。
  const licenseSvc = createDesktopLicenseService(getDb())
  licenseSvc.getStatus()
  // v1.4 试用 7 天全功能：统一计算"当前生效授权载荷"，惰性重读以感知激活。
  // expired 一律返回 null（防过期越权使用专业版功能）；
  // trial/activated 返回真实授权（已激活）或试用全功能载荷（未激活试用中）。
  const currentLicensePayload = () => {
    const phase = licenseSvc.getStatus().phase
    const fullAccess = phase === 'trial' || phase === 'activated'
    const row = getDb().prepare("SELECT value FROM app_setting WHERE key='license.code'").pluck().get() as
      | string
      | undefined
    return effectiveLicensePayload(row ? licenseSvc.verifyFormat(row) : null, fullAccess)
  }
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
    // 新试用策略：expired（试用 7 天期满未激活）→ 只读模式，拦截业务单据写通道；
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
    // v1.4 授权门控：激活后授权可变，惰性重读；试用 7 天全功能由 currentLicensePayload 统一包装。
    licensePayload: () => currentLicensePayload(),
    auditSvc: () => auditSvc
  }
  for (const { channel, handler } of buildAllHandlers(handlerDeps)) {
    registerIpc({
      [channel]: (evt, payload) => {
        // v1.4 客户端角色保护：本机已连接主机时，业务操作一律经 preload 路由到主机
        // （'lan:invoke'）。若仍落到本机 handler（首屏竞态/异常路径）→ 明确拒绝，
        // 避免把数据写进本机库造成主机/客户端数据分叉。
        if (clientModeActive) {
          throw new BizError('E_CLIENT_MODE', '本机已作为客户端连接到主机，业务操作需在主机上执行')
        }
        return handler(evt, payload)
      }
    })
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
    setPairResult?(code: string, result: { status: 'pending' | 'granted' | 'denied'; deviceId?: string; secretHex?: string; deviceName?: string; fingerprintHex?: string }): void
    /** T9：HTTP /pair/start 到达回调（同步进 host:pairPending 列表）。 */
    setPairRequestCb?(cb: (entry: { code: string; deviceName: string; expiresAt: number }) => void): void
    disconnectDevice?(deviceId: string, closeCode?: number): number
  }
  let hostServer: HostServerHandleLike | null = null
  // v1.3 Task 8: pairing 实例提升到模块级闭包（host:* IPC 需在主机 IIFE 外可调）。
  let pairingRef: import('./host/pairing').PairingService | null = null
  // v1.4 试用 7 天全功能：LAN 主机启动判定（启动时一次性决策）也用包装后的载荷。
  const licensePayload = currentLicensePayload()
  // v1.4 maxDevices：pairGrant 前检查未吊销设备数是否已达授权上限（activation 之后授权可变，惰性重读）。
  const assertDeviceLimit = (): void => {
    const count = (getDb().prepare('SELECT COUNT(*) AS c FROM host_devices WHERE revoked_at IS NULL').get() as { c: number }).c
    assertMaxDevices(currentLicensePayload(), count)
  }
  const lanEnabledRow = getDb().prepare("SELECT value FROM app_setting WHERE key='host_lan_enabled'").pluck().get() as
    | string
    | undefined
  // v1.4 终审 S5：主机/客户端角色互斥。本机已配置为 LAN 客户端（client.host_address 非空）时，
  // 即便误开主机开关也不启动主机服务，避免远端请求把数据写进本机库造成双库分叉。
  const clientConfiguredRow = getDb().prepare("SELECT value FROM app_setting WHERE key='client.host_address'").pluck().get() as
    | string
    | undefined
  const canRunHost =
    hasFeature(licensePayload, 'lan_collaboration') && lanEnabledRow === '1' && !clientConfiguredRow
  // v1.3 Task 8: Tray 门控复用的组合布尔（原 if 条件追加提炼，语义不变）。
  const lanAllowed = canRunHost
  lanAllowedRef = lanAllowed
  if (canRunHost) {
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
      // v1.4 终审 S5：主机网关 handler 也做角色互斥（与本地 IPC 的 E_CLIENT_MODE 包装同口径）。
      // 若运行中本机被配置为 LAN 客户端（clientModeActive=true），远端普通业务请求一律拒绝写本机库，
      // 防止「一台机器既当主机又当客户端」造成双库分叉。
      const handlers = new Map(
        buildAllHandlers(handlerDeps).map((h) => [
          h.channel,
          {
            channel: h.channel,
            handler: (evt: unknown, payload: unknown, session?: unknown) => {
              if (clientModeActive) {
                throw new BizError('E_CLIENT_MODE', '本机已作为客户端连接到主机，业务操作需在主机上执行')
              }
              return h.handler(evt, payload, session)
            }
          }
        ])
      )
      // v1.4（B4/T5 修复）：客户端重连探测通道 session:ping——无副作用、不查业务表、
      // 不需要任何业务权限，仅要求有效会话 + 正确 HMAC 签名。
      // 注意：只注册到主机网关的 handler 表（不进 buildAllHandlers，避免污染 IPC 通道清单）。
      handlers.set('session:ping', {
        channel: 'session:ping',
        handler: async () => ({ pong: true, at: Date.now() })
      })
      // v1.4（A1）：主机自签证书指纹下发给客户端做 TLS pinning（客户端不采信 TOFU）。
      hostFingerprintHexRef = cert.fingerprintHex
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
        // v1.4（A1）：/pair/start 与 /pair/result(granted) 响应带主机证书指纹 → 客户端 pinning。
        getFingerprintHex: () => hostFingerprintHexRef,
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
    // v1.4 授权门控说明：sync:now / sync:download / sync:restoreFromCloud（云盘备份与"两台电脑云盘接力"）
    // 属基础版定价（¥199 含云盘备份 + 云盘接力上传），故 device_handoff 特征位不做门控，两档均放行。
    // 仅 LAN 协同（lan_collaboration）、多仓（multi_warehouse）、序列号/批次效期（serial_batch）、
    // RBAC（rbac）、多设备（maxDevices）为专业版（¥399）专属，在相应通道/license-gate.ts 处门控。
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
          // v1.4（A1）：granted 时一并下发主机证书指纹 → 客户端据此 pinning（不采信 TOFU）。
          hostServer.setPairResult(code.trim(), {
            status: 'granted',
            deviceId,
            secretHex,
            fingerprintHex: hostFingerprintHexRef ?? undefined
          })
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

  // ── v1.4 客户端接线：本机作为 LAN 客户端（配对 / 会话 / 通道转发 / 写操作暂停） ──
  // 授权门控（按更严格方向实现 licensed per device，用户裁决待定）：
  // 客户端模式要求**本机**授权含 lan_collaboration（专业版）；试用 7 天内放行、试用到期拒绝。
  // 与主进程其它门控统一经 currentLicensePayload()：trial → TRIAL_FULL_PAYLOAD（含 lan）、
  // expired → null、activated → 真实授权，避免"硬编码试用放行"造成口径分叉。
  const assertClientLicensed = (): void => {
    assertFeature(currentLicensePayload(), 'lan_collaboration')
  }

  // 凭据存储（DPAPI）：safeStorage 只能动态 import，故用代理对象延后绑定；
  // DPAPI 不可用时**不明文落盘**（client-credentials.ts 内部返回不可用 → 只降级内存态）。
  let credentialStore: import('./host/client-credentials').HostCredentialStore | null = null
  const credentialStoreProxy: import('./host/client-credentials').HostCredentialStore = {
    available: () => credentialStore?.available() ?? false,
    save: (hostAddress, cred) => credentialStore?.save(hostAddress, cred) ?? false,
    load: (hostAddress) =>
      credentialStore?.load(hostAddress) ?? { secretHex: '', fingerprintHex: '', token: '' },
    remove: (hostAddress) => credentialStore?.remove(hostAddress)
  }

  // pending 幂等登记落盘（退出 flush → 持久化；重启后按原 requestId 重发，主机幂等表防重复过账）。
  const pendingFilePath = (): string => join(app.getPath('userData'), 'client-pending.json')
  const pendingPersist: import('./host/pending-registry').PendingRegistryDeps = {
    persist: {
      load(): import('./host/pending-registry').PendingEntry[] {
        try {
          const raw = readFileSync(pendingFilePath(), 'utf8')
          const parsed: unknown = JSON.parse(raw)
          if (!Array.isArray(parsed)) return []
          // v1.4 终审 S5：逐项校验，损坏/被篡改的文件不得把畸形条目灌进 pending Map
          // （pending-registry 会直接 map.set(e.requestId, e)，缺字段会污染重发流程）。
          return parsed.filter(
            (e): e is import('./host/pending-registry').PendingEntry =>
              !!e &&
              typeof e === 'object' &&
              typeof (e as { requestId?: unknown }).requestId === 'string' &&
              (e as { requestId: string }).requestId.length > 0 &&
              typeof (e as { channel?: unknown }).channel === 'string' &&
              (e as { channel: string }).channel.length > 0 &&
              'payload' in (e as object)
          )
        } catch {
          return []
        }
      },
      save: (entries: import('./host/pending-registry').PendingEntry[]): void => {
        try {
          const tmp = `${pendingFilePath()}.${process.pid}.tmp`
          writeFileSync(tmp, JSON.stringify(entries), 'utf8')
          renameSync(tmp, pendingFilePath())
        } catch (e) {
          console.warn('[client] pending persist failed:', e)
        }
      }
    }
  }

  const clientConn = createClientConnectionImpl({
    getSetting: (key: string) => {
      const row = getDb().prepare('SELECT value FROM app_setting WHERE key=?').pluck().get(key) as
        | string
        | undefined
      return row ?? null
    },
    setSetting: (key: string, value: string) => {
      getDb()
        .prepare(
          'INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(key, value)
    },
    credentialStore: credentialStoreProxy,
    pendingPersist,
    assertLicensed: assertClientLicensed,
    onStateChanged: (state: import('./host/client-connection').ClientConnectionState) => {
      clientModeActive = state.configured || state.status !== 'idle'
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('lan:client-state', state)
    },
    log: (level: string, msg: string) => console.log(`[client:${level}] ${msg}`)
  })
  clientConnectionRef = clientConn

  // 凭据存储就绪后恢复已保存的客户端配置（DPAPI 载入 secret/指纹/token）。
  void (async () => {
    try {
      const { safeStorage } = await import('electron')
      const { createHostCredentialStore } = await import('./host/client-credentials')
      credentialStore = createHostCredentialStore({ userDataDir: app.getPath('userData'), safeStorage })
      await clientConn.restore()
    } catch (e) {
      console.warn('[client] credential store unavailable (re-pair after restart):', e)
    }
  })()

  // preload 首屏竞态消除：preload 同步拉一次客户端状态（必须在 createWindow 之前注册）。
  ipcMain.on('lan:clientStatusSync', (event) => {
    event.returnValue = clientConn.status()
  })

  // lan: 通道不进 PERMISSION_MAP（默认守卫会一律拒绝），故显式给守卫。
  // 'lan:invoke' 是业务通道转发口——权限由**主机侧**按会话用户判定（server.ts 的 canFor）。
  registerIpc(
    {
      'lan:clientStatus': () => clientConn.status(),
      'lan:invoke': async (_evt, payload) => {
        const { channel, payload: inner } = (payload ?? {}) as { channel?: unknown; payload?: unknown }
        if (typeof channel !== 'string' || !channel) throw new BizError('VALIDATION', '缺少通道名')
        // v1.4 终审 S4：本机 LAN 客户端转发口统一按「按机授权」判定，试用到期/基础版不得
        // 借 restore/重连/lan:invoke 继续用 LAN 协作（与 pairStart 门控口径一致）。
        assertClientLicensed()
        // v1.4 终审 S4：通道白名单——本机专用（license:/host:/lan:/auth: 等）与主机专用
        // （backup:/sync:）通道不得经转发口直达主进程/远端，避免 preload 路由被绕过。
        if (
          matchesPrefix(channel, LOCAL_CHANNEL_PREFIXES) ||
          matchesPrefix(channel, HOST_ONLY_PREFIXES)
        ) {
          throw new BizError('NO_PERMISSION', `通道 ${channel} 不支持局域网转发`)
        }
        const r = await clientConn.invoke(channel, inner)
        if (!r.ok) throw new BizError(r.code, r.msg || '主机请求失败')
        return r.data
      }
    },
    () => true
  )
  // 客户端管理通道（配对/连接/断开/忘记）属本机管理功能：admin only。
  registerIpc(
    {
      'lan:clientPairStart': async (_evt, payload) => {
        const { address, deviceName, username, password } = (payload ?? {}) as {
          address?: unknown
          deviceName?: unknown
          username?: unknown
          password?: unknown
        }
        const r = await clientConn.pairStart({
          address: String(address ?? ''),
          deviceName: String(deviceName ?? ''),
          username: String(username ?? ''),
          password: String(password ?? '')
        })
        if (!r.ok) throw new BizError(r.code, r.msg)
        return r.data
      },
      'lan:clientConnect': async (_evt, payload) => {
        const { username, password } = (payload ?? {}) as { username?: unknown; password?: unknown }
        const r = await clientConn.reconnect({
          username: String(username ?? ''),
          password: String(password ?? '')
        })
        if (!r.ok) throw new BizError(r.code, r.msg)
        return r.data
      },
      'lan:clientDisconnect': () => {
        const r = clientConn.disconnect()
        if (!r.ok) throw new BizError(r.code, r.msg)
        return r.data
      },
      'lan:clientForget': () => {
        const r = clientConn.forget()
        if (!r.ok) throw new BizError(r.code, r.msg)
        return r.data
      }
    },
    () => getCurrentUser()?.role === 'admin'
  )

  // ── 系统托盘（v1.4.1 用户 m06828：无条件创建——关闭窗口=最小化到托盘，托盘右键「退出」才真正退出。
  // v1.3 Task 8 的 LAN 主机状态菜单项保留（lanAllowed=false 时该两项显示「主机未启用」）。 ──
  void (async () => {
    try {
      const { Tray, Menu, nativeImage } = await import('electron')
      const iconPath = app.isPackaged
        ? join(process.resourcesPath, 'hesora.png')
        : join(app.getAppPath(), 'resources/hesora.png')
      const tray = new Tray(nativeImage.createFromPath(iconPath))
      tray.setToolTip('禾序进销存')
      trayRef = tray
      const rebuildMenu = (): void => {
        const deviceCount = pairingRef
          ? pairingRef.listDevices().filter((d) => d.revoked_at === null).length
          : 0
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: hostServer ? '主机状态：运行中 (18650)' : '主机状态：未启用', enabled: false },
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
                // 彻底退出：先 flush 客户端 pending、关 hostServer、清 Tray，再 app.exit（绕过 window-all-closed 隐藏逻辑）。
                void (async () => {
                  // v1.4（B8）：app.exit 不触发 before-quit，pending flush 需在此显式执行。
                  try {
                    clientConnectionRef?.flushPending()
                  } catch { /* ignore */ }
                  try {
                    if (hostServerRef) await hostServerRef.close()
                  } catch { /* ignore */ }
                  try {
                    const { setHostEventSink } = await import('./host/event-bus')
                    setHostEventSink(null)
                  } catch { /* ignore */ }
                  trayRef = null
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

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  // v1.3 Task 5: 退出时关闭 LAN 主机服务（若已启动）。
  // T8 双审勘误（I5）：退出时摘除主机事件 sink，防止退出途中再向已关闭的 hub 广播。
  void (async () => {
    try {
      const { setHostEventSink } = await import('./host/event-bus')
      setHostEventSink(null)
    } catch { /* ignore */ }
  })()
  // v1.4（B8，消除 TODO(T9)）：flush **客户端** 的 pending 幂等登记（落盘），
  // 重启后按原 requestId 重发（主机幂等表保证只生效一次）。
  // 主机侧没有 pending 实例（主机不产生待重试请求），此处只 flush 客户端。
  try {
    clientConnectionRef?.flushPending()
  } catch (e) {
    console.warn('[client] pending flush failed:', e)
  }
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

// v1.4（B8）：退出前再 flush 一次客户端 pending（window-all-closed 未触发时也覆盖到）。
app.on('before-quit', () => {
  try {
    clientConnectionRef?.flushPending()
  } catch (e) {
    console.warn('[client] pending flush failed:', e)
  }
})
