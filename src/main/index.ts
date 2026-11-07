import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { PERMISSION_MAP } from './permissions-map'
import { setCurrentUser, getCurrentUser, can } from './auth'
import { createUserService } from './services/user/user.service'
import { createDesktopLicenseService } from './license'
import { applyPendingRestore } from './services/backup/backup.service'
import { createWorkflowService } from './services/workflow/workflow.service'
import { createAuditService } from './services/audit/audit.service'
import { BizError } from '../shared/result'
import type { WorkflowKind } from '../shared/types/workflow'
import { createProductService } from './services/product/product.service'
import { createCustomerService } from './services/customer/customer.service'
import { createSupplierService } from './services/supplier/supplier.service'
import { createWarehouseService } from './services/warehouse/warehouse.service'
import { createFundService } from './services/fund/fund.service'
import { createFundLedger } from './services/fund/ledger.service'
import { createSettingService } from './services/setting/setting.service'
import { createOpeningService } from './services/opening/opening.service'
import { createInventoryService } from './services/inventory/inventory.service'
import { createPurchaseService } from './services/purchase/purchase.service'
import { createSaleService } from './services/sale/sale.service'
import { createRetailService } from './services/retail/retail.service'
import { createDocService } from './services/doc/doc.service'
import { createPaymentService } from './services/payment/payment.service'
import { createArrearsService } from './services/stats/arrears.service'
import { createDashboardService } from './services/stats/dashboard.service'
import { createReportService } from './services/stats/report.service'
import { createTransferService } from './services/transfer/transfer.service'
import { createStocktakeService } from './services/stocktake/stocktake.service'
import { createAssembleService } from './services/assemble/assemble.service'
import { createPrintIpc } from './print'
import { createCsvIpc } from './csv'
import { createBackupIpc } from './backup'
import { registerUpdateIpc } from './update'
import type { Product } from '../shared/types/product'
import type { DocQuery, DocType } from '../shared/types/doc'
import type { PaymentCreateInput, PaymentType } from '../shared/types/payment'
import type { FundTransferInput } from '../shared/types/fund-ledger'

// Preserve existing accounts and backups across the HESORA rebrand.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'zhjs-erp'))
}
if (process.platform === 'win32') app.setAppUserModelId('com.zhjs.erp')

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
  }
  return database
}

let productService: ReturnType<typeof createProductService> | null = null
function getProductService(): ReturnType<typeof createProductService> {
  if (!productService) {
    productService = createProductService(getDb())
  }
  return productService
}

let inventoryService: ReturnType<typeof createInventoryService> | null = null
function getInventoryService(): ReturnType<typeof createInventoryService> {
  if (!inventoryService) {
    inventoryService = createInventoryService(getDb())
  }
  return inventoryService
}

let customerService: ReturnType<typeof createCustomerService> | null = null
function getCustomerService(): ReturnType<typeof createCustomerService> {
  if (!customerService) {
    customerService = createCustomerService(getDb())
  }
  return customerService
}

let supplierService: ReturnType<typeof createSupplierService> | null = null
function getSupplierService(): ReturnType<typeof createSupplierService> {
  if (!supplierService) {
    supplierService = createSupplierService(getDb())
  }
  return supplierService
}

let warehouseService: ReturnType<typeof createWarehouseService> | null = null
function getWarehouseService(): ReturnType<typeof createWarehouseService> {
  if (!warehouseService) {
    warehouseService = createWarehouseService(getDb())
  }
  return warehouseService
}

let fundService: ReturnType<typeof createFundService> | null = null
function getFundService(): ReturnType<typeof createFundService> {
  if (!fundService) {
    fundService = createFundService(getDb())
  }
  return fundService
}

let settingService: ReturnType<typeof createSettingService> | null = null
function getSettingService(): ReturnType<typeof createSettingService> {
  if (!settingService) {
    settingService = createSettingService(getDb())
  }
  return settingService
}

let openingService: ReturnType<typeof createOpeningService> | null = null
function getOpeningService(): ReturnType<typeof createOpeningService> {
  if (!openingService) {
    openingService = createOpeningService(getDb())
  }
  return openingService
}

let purchaseService: ReturnType<typeof createPurchaseService> | null = null
function getPurchaseService(): ReturnType<typeof createPurchaseService> {
  if (!purchaseService) {
    purchaseService = createPurchaseService(getDb())
  }
  return purchaseService
}

let saleService: ReturnType<typeof createSaleService> | null = null
function getSaleService(): ReturnType<typeof createSaleService> {
  if (!saleService) {
    saleService = createSaleService(getDb())
  }
  return saleService
}

let retailService: ReturnType<typeof createRetailService> | null = null
function getRetailService(): ReturnType<typeof createRetailService> {
  if (!retailService) {
    retailService = createRetailService(getDb())
  }
  return retailService
}

let transferService: ReturnType<typeof createTransferService> | null = null
function getTransferService(): ReturnType<typeof createTransferService> {
  if (!transferService) {
    transferService = createTransferService(getDb())
  }
  return transferService
}

let stocktakeService: ReturnType<typeof createStocktakeService> | null = null
function getStocktakeService(): ReturnType<typeof createStocktakeService> {
  if (!stocktakeService) {
    stocktakeService = createStocktakeService(getDb())
  }
  return stocktakeService
}

let assembleService: ReturnType<typeof createAssembleService> | null = null
function getAssembleService(): ReturnType<typeof createAssembleService> {
  if (!assembleService) {
    assembleService = createAssembleService(getDb())
  }
  return assembleService
}

let paymentService: ReturnType<typeof createPaymentService> | null = null
function getPaymentService(): ReturnType<typeof createPaymentService> {
  if (!paymentService) {
    paymentService = createPaymentService(getDb())
  }
  return paymentService
}

let dashboardService: ReturnType<typeof createDashboardService> | null = null
function getDashboardService(): ReturnType<typeof createDashboardService> {
  if (!dashboardService) {
    dashboardService = createDashboardService(getDb())
  }
  return dashboardService
}

let arrearsService: ReturnType<typeof createArrearsService> | null = null
function getArrearsService(): ReturnType<typeof createArrearsService> {
  if (!arrearsService) {
    arrearsService = createArrearsService(getDb())
  }
  return arrearsService
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
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  const prevGuard = (channel: string): boolean => {
    const perm = PERMISSION_MAP[channel]
    return perm !== undefined && can(perm)
  }
  setDefaultPermissionGuard((channel) => {
    if (channel.startsWith('auth:') || channel.startsWith('license:') || channel.startsWith('update:')) return true
    if (!prevGuard(channel)) return false
    const status = licenseSvc.getStatus()
    if (status.mode === 'trial' && status.daysLeft !== undefined && status.daysLeft <= 0) {
      return false
    }
    return true
  })
  registerIpc({
    'license:check': () => licenseSvc.getStatus(),
    'license:activate': (_evt, payload) => licenseSvc.activate(String(payload)),
    'license:activateOnline': (_evt, payload) => licenseSvc.activateOnline(String(payload))
  })

  const workflow = createWorkflowService(getDb())
  function reviewerId(): number {
    const user = getCurrentUser()
    if (user?.role !== 'admin') throw new BizError('FORBIDDEN', '只有管理员可以审核和转单')
    return user.id
  }
  registerIpc({
    'workflow:list': (_evt, payload) => {
      reviewerId()
      const { page, kind } = payload as { page?: number; kind?: WorkflowKind }
      return workflow.list(page, kind)
    },
    'workflow:save': (_evt, payload) => workflow.save(payload as Parameters<typeof workflow.save>[0], reviewerId()),
    'workflow:approve': (_evt, payload) => workflow.approve(Number(payload), reviewerId()),
    'workflow:convert': (_evt, payload) => {
      const { id, target } = payload as { id: number; target?: WorkflowKind }
      return workflow.convert(id, reviewerId(), target)
    },
    'workflow:cancel': (_evt, payload) => workflow.cancel(Number(payload), reviewerId())
  })
  const svc = getProductService()
  function visibleProduct<T extends Product | null>(product: T): T {
    if (!product || getCurrentUser()?.role === 'admin') return product
    return { ...product, purchase_price: 0 }
  }
  registerIpc({
    'product:create': (_evt, payload) => svc.create(payload as never),
    'product:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      getDb().transaction(() => {
        const before = svc.getById(id)
        svc.update(id, p)
        const after = svc.getById(id)
        if (before && after && (before.retail_price !== after.retail_price || before.trade_price !== after.trade_price || before.purchase_price !== after.purchase_price)) {
          const prices = (product: Product) => JSON.stringify({ retail: product.retail_price, trade: product.trade_price, purchase: product.purchase_price })
          auditSvc.record('product.price', getCurrentUser()?.username, after.code, prices(before), prices(after))
        }
      })()
    },
    'product:get': (_evt, payload) => visibleProduct(svc.getById(Number(payload))),
    'product:getByBarcode': (_evt, payload) => visibleProduct(svc.getByBarcode(String(payload))),
    'product:query': (_evt, payload) => {
      const result = svc.query(payload as never)
      return { ...result, list: result.list.map(visibleProduct) }
    },
    'product:disable': (_evt, payload) => svc.disable(Number(payload)),
    'product:enable': (_evt, payload) => svc.enable(Number(payload))
  })

  const customerSvc = getCustomerService()
  registerIpc({
    'customer:create': (_evt, payload) => customerSvc.create(payload as never),
    'customer:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      customerSvc.update(id, p)
    },
    'customer:get': (_evt, payload) => customerSvc.getById(Number(payload)),
    'customer:query': (_evt, payload) => customerSvc.query(payload as never),
    'customer:disable': (_evt, payload) => customerSvc.disable(Number(payload)),
    'customer:enable': (_evt, payload) => customerSvc.enable(Number(payload))
  })

  const supplierSvc = getSupplierService()
  registerIpc({
    'supplier:create': (_evt, payload) => supplierSvc.create(payload as never),
    'supplier:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      supplierSvc.update(id, p)
    },
    'supplier:get': (_evt, payload) => supplierSvc.getById(Number(payload)),
    'supplier:query': (_evt, payload) => supplierSvc.query(payload as never),
    'supplier:disable': (_evt, payload) => supplierSvc.disable(Number(payload)),
    'supplier:enable': (_evt, payload) => supplierSvc.enable(Number(payload))
  })

  const warehouseSvc = getWarehouseService()
  registerIpc({
    'warehouse:create': (_evt, payload) => warehouseSvc.create(payload as never),
    'warehouse:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      warehouseSvc.update(id, p)
    },
    'warehouse:get': (_evt, payload) => warehouseSvc.getById(Number(payload)),
    'warehouse:query': (_evt, payload) => warehouseSvc.query(payload as never),
    'warehouse:set-default': (_evt, payload) => warehouseSvc.setDefault(Number(payload)),
    'warehouse:disable': (_evt, payload) => warehouseSvc.disable(Number(payload)),
    'warehouse:enable': (_evt, payload) => warehouseSvc.enable(Number(payload))
  })

  const fundSvc = getFundService()
  const ledger = createFundLedger(getDb())
  const visibleFund = (fund: ReturnType<typeof fundSvc.getById>) =>
    fund && getCurrentUser()?.role !== 'admin' ? { ...fund, opening_balance: undefined } : fund
  registerIpc({
    'ledger:accounts': () => ledger.accounts(),
    'ledger:entries': (_evt, payload) => {
      const { accountId, page } = payload as { accountId: number; page: number }
      return ledger.entries(accountId, page)
    },
    'ledger:transfer': (_evt, payload) => ledger.transfer(payload as FundTransferInput, reviewerId()),
    'fund:create': (_evt, payload) => fundSvc.create(payload as never),
    'fund:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      fundSvc.update(id, p)
    },
    'fund:get': (_evt, payload) => visibleFund(fundSvc.getById(Number(payload))),
    'fund:query': (_evt, payload) => {
      const result = fundSvc.query(payload as never)
      return { ...result, list: result.list.map(visibleFund) }
    },
    'fund:disable': (_evt, payload) => fundSvc.disable(Number(payload)),
    'fund:enable': (_evt, payload) => fundSvc.enable(Number(payload))
  })

  const settingSvc = getSettingService()
  registerIpc({
    'setting:get': (_evt, payload) => settingSvc.get(String(payload)),
    'setting:set': (_evt, payload) => {
      const { key, value } = payload as { key: string; value: string }
      settingSvc.set(key, value)
    },
    'setting:getAll': () => settingSvc.getAll(),
    'setting:remove': (_evt, payload) => settingSvc.remove(String(payload))
  })

  const openingSvc = getOpeningService()
  registerIpc({
    'opening:save': (_evt, payload) => openingSvc.save(payload as never),
    'opening:getStatus': () => openingSvc.getStatus()
  })

  const invSvc = getInventoryService()
  registerIpc({
    'inventory:listCostLogs': (_evt, payload) => invSvc.listCostLogs(Number(payload)),
    'inventory:queryStock': (_evt, payload) => {
      const result = invSvc.queryStock(payload as never)
      if (getCurrentUser()?.role === 'admin') return result
      return { ...result, items: result.items.map((row) => ({ ...row, moving_cost: 0, amount: 0 })) }
    }
  })

  const purchaseSvc = getPurchaseService()
  registerIpc({
    'purchase:create': (_evt, payload) => purchaseSvc.create(payload as never),
    'purchase:createReturn': (_evt, payload) => purchaseSvc.createReturn(payload as never),
    'purchase:getDetail': (_evt, payload) => purchaseSvc.getDetail(Number(payload)),
    'purchase:query': (_evt, payload) => purchaseSvc.query(payload as never)
  })

  const saleSvc = getSaleService()
  registerIpc({
    'sale:create': (_evt, payload) => saleSvc.create(payload as never),
    'sale:createReturn': (_evt, payload) => saleSvc.createReturn(payload as never),
    'sale:getDetail': (_evt, payload) => saleSvc.getDetail(Number(payload)),
    'sale:query': (_evt, payload) => saleSvc.query(payload as never)
  })

  const retailSvc = getRetailService()
  const docSvc = createDocService(getDb())
  const cashierDocs: DocType[] = ['sale', 'sale_return', 'retail']
  function assertDocumentVisible(id: number): void {
    if (getCurrentUser()?.role === 'admin') return
    const doc = docSvc.getById(id)
    if (!doc || !cashierDocs.includes(doc.type)) throw new BizError('NO_PERMISSION', '当前操作员没有权限查看此单据')
  }
  registerIpc({
    'doc:query': (_evt, payload) => {
      const query = payload as DocQuery
      if (getCurrentUser()?.role === 'admin') return docSvc.query(query)
      const requested = query.type ? [query.type] : query.types?.length ? query.types : cashierDocs
      const types = requested.filter((type) => cashierDocs.includes(type))
      return types.length ? docSvc.query({ ...query, type: undefined, types }) : { items: [], total: 0 }
    },
    'doc:detail': (_evt, payload) => {
      const id = Number(payload)
      assertDocumentVisible(id)
      return docSvc.getDetailWithItems(id)
    }
  })
  registerIpc({
    'retail:create': (_evt, payload) => retailSvc.create(payload as never, getCurrentUser()!.id),
    'retail:hold': (_evt, payload) => retailSvc.hold(getCurrentUser()!.id, payload as never),
    'retail:listHeld': () => retailSvc.listHeld(getCurrentUser()!.id),
    'retail:discardHeld': (_evt, payload) => retailSvc.discardHeld(getCurrentUser()!.id, Number(payload)),
    'retail:getDetail': (_evt, payload) => retailSvc.getDetail(Number(payload)),
    'retail:query': (_evt, payload) => retailSvc.query(payload as never)
  })

  const paymentSvc = getPaymentService()
  function paymentType(type: unknown): PaymentType {
    if (type === 'receipt' || type === 'payment' || type === 'other_in' || type === 'other_out') return type
    throw new BizError('VALIDATION', '资金单据类型无效')
  }
  registerIpc({
    'payment:create': (_evt, payload) => {
      const { type, p } = payload as { type: unknown; p: PaymentCreateInput }
      return paymentSvc.createOne(paymentType(type), p)
    },
    'payment:query': (_evt, payload) => {
      const { type, q } = payload as { type: unknown; q: Omit<DocQuery, 'type'> }
      return paymentSvc.query(paymentType(type), q)
    },
    'payment:getDetail': (_evt, payload) => {
      const { type, id } = payload as { type: unknown; id: number }
      return paymentSvc.getDetail(paymentType(type), id)
    },
    'payment:createReceipt': (_evt, payload) => paymentSvc.createReceipt(payload as never),
    'payment:createPayment': (_evt, payload) => paymentSvc.createPayment(payload as never),
    'payment:getReceiptDetail': (_evt, payload) => paymentSvc.getReceiptDetail(Number(payload)),
    'payment:getPaymentDetail': (_evt, payload) => paymentSvc.getPaymentDetail(Number(payload)),
    'payment:queryReceipt': (_evt, payload) => paymentSvc.queryReceipt(payload as never),
    'payment:queryPayment': (_evt, payload) => paymentSvc.queryPayment(payload as never)
  })

  const arrearsSvc = getArrearsService()
  const reportSvc = createReportService(getDb())
  registerIpc({
    'stats:receivables': () => arrearsSvc.receivables(),
    'stats:payables': () => arrearsSvc.payables(),
    'stats:summary': () => arrearsSvc.summary(),
    'stats:report': (_evt, payload) => reportSvc.query(payload as never)
  })

  const dashboardSvc = getDashboardService()
  registerIpc({
    'dashboard:summary': (_evt, payload) => {
      const summary = dashboardSvc.summary(String(payload))
      return getCurrentUser()?.role === 'admin' ? summary : {
        ...summary, gross_profit: null, stock_amount: null, total_receivable: null, total_payable: null
      }
    },
    'dashboard:trend': (_evt, payload) => {
      const { days } = (payload ?? {}) as { days?: number }
      return dashboardSvc.trend(Number(days) || 7)
    }
  })

  const transferSvc = getTransferService()
  registerIpc({
    'transfer:create': (_evt, payload) => transferSvc.create(payload as never),
    'transfer:getDetail': (_evt, payload) => transferSvc.getDetail(Number(payload)),
    'transfer:query': (_evt, payload) => transferSvc.query(payload as never)
  })

  const stocktakeSvc = getStocktakeService()
  registerIpc({
    'stocktake:getSheet': (_evt, payload) => {
      const { warehouse_id, keyword } = payload as { warehouse_id: number; keyword?: string }
      return stocktakeSvc.getSheet(Number(warehouse_id), keyword)
    },
    'stocktake:create': (_evt, payload) => stocktakeSvc.create(payload as never),
    'stocktake:getDetail': (_evt, payload) => stocktakeSvc.getDetail(Number(payload)),
    'stocktake:query': (_evt, payload) => stocktakeSvc.query(payload as never)
  })

  const assembleSvc = getAssembleService()
  registerIpc({
    'assemble:create': (_evt, payload) => assembleSvc.create(payload as never),
    'assemble:disassemble': (_evt, payload) => assembleSvc.disassemble(payload as never),
    'assemble:getDetail': (_evt, payload) => assembleSvc.getDetail(Number(payload)),
    'assemble:getDisassembleDetail': (_evt, payload) => assembleSvc.getDisassembleDetail(Number(payload)),
    'assemble:query': (_evt, payload) => assembleSvc.query(payload as never)
  })

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
    'audit:list': () => auditSvc.list(),
    'csv:export': async (_evt, payload) => {
      const { kind, params } = payload as { kind: string; params?: Record<string, unknown> }
      const operator = getCurrentUser()?.username
      const file = await csvIpc.exportCsv(kind as never, (params ?? {}) as never)
      if (file) auditSvc.record('data.export', operator, kind)
      return file
    },
    'csv:importProducts': (_evt, payload) => {
      const { fileContent } = payload as { fileContent: string }
      return csvIpc.importProducts(String(fileContent))
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

  const backupIpc = createBackupIpc(getDb())
  backupIpc.autoBackup()
  registerIpc({
    'backup:now': () => backupIpc.backupNow(),
    'backup:pickDir': () => backupIpc.pickDir(),
    'backup:list': () => backupIpc.backupList(),
    'backup:restore': (_evt, payload) => backupIpc.restoreBackup(String(payload)),
    'sync:getConfig': () => backupIpc.syncGetConfig(),
    'sync:saveConfig': (_evt, payload) => backupIpc.syncSaveConfig(payload),
    'sync:now': () => backupIpc.syncNow(),
    'sync:download': () => backupIpc.syncDownload(),
    'sync:restoreFromCloud': (_evt, payload) => backupIpc.restoreFromCloud(String(payload))
  })

  const userSvc = createUserService(getDb())
  registerIpc({
    'auth:setupStatus': () => userSvc.setupStatus(),
    'auth:setup': (_evt, payload) => {
      const { username, password } = payload as { username: string; password: string }
      const user = userSvc.setupAdmin(String(username), String(password))
      setCurrentUser(user)
      return user
    },
    'auth:login': (_evt, payload) => {
      const { username, password } = payload as { username: string; password: string }
      const user = userSvc.verify(String(username), String(password))
      if (!user) return null
      setCurrentUser(user)
      return user
    },
    'auth:current': () => getCurrentUser(),
    'auth:logout': () => {
      setCurrentUser(null)
      return true
    },
    'user:query': () => userSvc.query(),
    'user:get': (_evt, payload) => userSvc.getById(Number(payload)),
    'user:create': (_evt, payload) =>
      userSvc.create(payload as { username: string; password: string; role: 'admin' | 'cashier' }),
    'user:update': (_evt, payload) => {
      const { id, patch } = payload as {
        id: number
        patch: { password?: string; role?: 'admin' | 'cashier'; disabled?: number | boolean }
      }
      return userSvc.update(Number(id), patch)
    },
    'user:remove': (_evt, payload) => {
      userSvc.remove(Number(payload))
      return true
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
