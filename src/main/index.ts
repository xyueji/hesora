import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { openDb, type DB } from './db'
import { resolveDatabasePath } from './db/location'
import { ensureProfileDir, resolveProfilePath } from './db/profile'
import { seedDemoData } from './db/seed'
import { registerIpc, setDefaultPermissionGuard } from './ipc/register'
import { PERMISSION_MAP } from './permissions-map'
import { setCurrentUser, getCurrentUser, can } from './auth'
import { createUserService } from './services/user/user.service'
import { createDesktopLicenseService } from './license'
import { applyPendingRestore } from './services/backup/backup.service'
import { createWorkflowService } from './services/workflow/workflow.service'
import { createAuditService } from './services/audit/audit.service'
import { BizError } from '../shared/result'
import { isPermissionKey, type PermissionKey, type RoleInput } from '../shared/permissions'
import { WORKFLOW_KINDS, type FulfillmentRequest, type WorkflowKind } from '../shared/types/workflow'
import { createProductService } from './services/product/product.service'
import { createPriceLevelService } from './services/product/price-level.service'
import { createShelfLifeService } from './services/product/shelf-life.service'
import { createCustomerService } from './services/customer/customer.service'
import { createSupplierService } from './services/supplier/supplier.service'
import { createWarehouseService } from './services/warehouse/warehouse.service'
import { createFundService } from './services/fund/fund.service'
import { createFundLedger } from './services/fund/ledger.service'
import { createSettingService } from './services/setting/setting.service'
import { createOpeningService } from './services/opening/opening.service'
import { createInventoryService } from './services/inventory/inventory.service'
import { createStockReportService } from './services/inventory/stock-report.service'
import { createSerialService } from './services/inventory/serial.service'
import { createPurchaseService } from './services/purchase/purchase.service'
import { createSaleService } from './services/sale/sale.service'
import { createRetailService } from './services/retail/retail.service'
import { createDocService } from './services/doc/doc.service'
import { createDocCopyService } from './services/doc/copy.service'
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
  function workflowAllowed(kind: WorkflowKind): boolean {
    return WORKFLOW_KINDS.includes(kind) && can(kind === 'purchase_order' || kind === 'purchase' ? 'doc.purchase' : 'doc.sale')
  }
  function workflowActor(kind: WorkflowKind): number {
    const user = getCurrentUser()
    if (!user || !can('doc.workflow') || !workflowAllowed(kind)) throw new BizError('FORBIDDEN', '当前操作员无此类单据的工作流权限')
    return user.id
  }
  function reviewerId(): number {
    const user = getCurrentUser()
    if (user?.role !== 'admin') throw new BizError('FORBIDDEN', '只有管理员可以审核和转单')
    return user.id
  }
  registerIpc({
    'workflow:list': (_evt, payload) => {
      const { page, kind } = payload as { page?: number; kind?: WorkflowKind }
      return workflow.list(page, kind, WORKFLOW_KINDS.filter(workflowAllowed))
    },
    'workflow:save': (_evt, payload) => {
      const input = payload as Parameters<typeof workflow.save>[0]
      if (input.id !== undefined) workflowActor(workflow.get(input.id).kind)
      return workflow.save(input, workflowActor(input.kind))
    },
    'workflow:approve': (_evt, payload) => {
      const id = Number(payload)
      return workflow.approve(id, workflowActor(workflow.get(id).kind))
    },
    'workflow:convert': (_evt, payload) => {
      const { id, target, quantities } = payload as { id: number; target?: WorkflowKind; quantities?: FulfillmentRequest[] }
      return workflow.convert(id, workflowActor(workflow.get(id).kind), target, quantities)
    },
    'workflow:cancel': (_evt, payload) => {
      const id = Number(payload)
      return workflow.cancel(id, workflowActor(workflow.get(id).kind))
    }
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

  // 价格等级 + 保质期/批次效期（商品主档增强）
  const priceLevelSvc = createPriceLevelService(getDb())
  const shelfLifeSvc = createShelfLifeService(getDb())
  registerIpc({
    'product:priceLevels': (_evt, payload) => {
      const { productId } = payload as { productId: number }
      return priceLevelSvc.getLevels(Number(productId))
    },
    'product:savePriceLevels': (_evt, payload) => {
      const { productId, levels } = payload as { productId: number; levels: never[] }
      priceLevelSvc.setLevels(Number(productId), levels)
      return true
    },
    'product:setShelfLife': (_evt, payload) => {
      const { productId, config } = payload as { productId: number; config: never }
      shelfLifeSvc.setShelfLife(Number(productId), config)
      return true
    },
    'product:batches': (_evt, payload) => shelfLifeSvc.listBatches(payload as never),
    'product:saveBatch': (_evt, payload) => {
      const { productId, warehouseId, batchNo, data } = payload as {
        productId: number
        warehouseId: number
        batchNo: string
        data?: { production_date?: string; expire_date?: string; remark?: string }
      }
      return shelfLifeSvc.ensureBatch(Number(productId), Number(warehouseId), String(batchNo ?? ''), data ?? {})
    }
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

  // 库存明细报表：统计明细/成本变动/库存流水/预警/批量调价
  const stockReportSvc = createStockReportService(getDb())
  registerIpc({
    'stock:statisticsDetail': (_evt, payload) => stockReportSvc.statisticsDetail(payload as never),
    'stock:costChanges': (_evt, payload) => stockReportSvc.costChanges(payload as never),
    'stock:flows': (_evt, payload) => stockReportSvc.stockFlow(payload as never),
    'stock:warnings': (_evt, payload) => stockReportSvc.warnings(payload as never),
    'stock:setWarning': (_evt, payload) => {
      const { product_id, min_stock } = payload as { product_id: number; min_stock: number }
      stockReportSvc.setWarning(Number(product_id), Number(min_stock))
      return true
    },
    'stock:setWarningsByCondition': (_evt, payload) => {
      const { condition, min_stock } = payload as { condition: never; min_stock: number }
      return stockReportSvc.setWarningsByCondition(condition, Number(min_stock))
    },
    'stock:adjustPrices': (_evt, payload) => {
      const { items, operator } = payload as { items: never[]; operator?: string }
      return stockReportSvc.adjustPrices(items, operator)
    }
  })

  // 序列号台账
  const serialSvc = createSerialService(getDb())
  registerIpc({
    'serial:registerIn': (_evt, payload) => serialSvc.registerIn(payload as never),
    'serial:consumeOut': (_evt, payload) => serialSvc.consumeOut(payload as never),
    'serial:stock': (_evt, payload) => serialSvc.listStock(payload as never),
    'serial:flows': (_evt, payload) => serialSvc.listFlow(payload as never),
    'serial:validate': (_evt, payload) => {
      const { sns, productId, direction } = payload as {
        sns: string[]
        productId: number
        direction?: 'in' | 'out'
      }
      return serialSvc.validateSns(Number(productId), sns, direction)
    },
    'serial:stockOf': (_evt, payload) => serialSvc.stockOf(Number(payload))
  })

  const docSvc = createDocService(getDb())
  const documentPermissions: Record<DocType, PermissionKey> = {
    purchase: 'doc.purchase', purchase_return: 'doc.purchase', sale: 'doc.sale', sale_return: 'doc.sale',
    retail: 'doc.retail', transfer: 'inventory.adjust', stocktake: 'inventory.adjust',
    assemble: 'inventory.assemble', disassemble: 'inventory.assemble', receipt: 'doc.payment',
    payment: 'doc.payment', other_in: 'doc.payment', other_out: 'doc.payment'
  }
  function canViewDocument(type: DocType): boolean {
    return Object.hasOwn(documentPermissions, type) && can(documentPermissions[type])
  }
  function assertDocumentVisible(id: number): void {
    const doc = docSvc.getById(id)
    if (!doc || !canViewDocument(doc.type)) throw new BizError('NO_PERMISSION', '当前操作员没有权限查看此单据')
  }

  // 单据复制（再来一单）
  const docCopySvc = createDocCopyService(getDb())
  registerIpc({
    'doc:copy': (_evt, payload) => {
      const { docId, overrides } = payload as { docId: number; overrides?: never }
      assertDocumentVisible(Number(docId))
      return docCopySvc.copy(Number(docId), overrides)
    }
  })

  const purchaseSvc = getPurchaseService()
  registerIpc({
    'purchase:create': (_evt, payload) => {
      if (!can('doc.approve')) throw new BizError('FORBIDDEN', '请先保存进货草稿，由有审核权限的操作员过账')
      return purchaseSvc.create(payload as never)
    },
    'purchase:createReturn': (_evt, payload) => purchaseSvc.createReturn(payload as never),
    'purchase:getDetail': (_evt, payload) => purchaseSvc.getDetail(Number(payload)),
    'purchase:query': (_evt, payload) => purchaseSvc.query(payload as never)
  })

  const saleSvc = getSaleService()
  registerIpc({
    'sale:create': (_evt, payload) => {
      if (!can('doc.approve')) throw new BizError('FORBIDDEN', '请先保存销售草稿，由有审核权限的操作员过账')
      return saleSvc.create(payload as never)
    },
    'sale:createReturn': (_evt, payload) => saleSvc.createReturn(payload as never),
    'sale:getDetail': (_evt, payload) => saleSvc.getDetail(Number(payload)),
    'sale:query': (_evt, payload) => saleSvc.query(payload as never)
  })

  const retailSvc = getRetailService()
  registerIpc({
    'doc:query': (_evt, payload) => {
      const query = payload as DocQuery
      const requested = query.type ? [query.type] : query.types?.length ? query.types : Object.keys(documentPermissions) as DocType[]
      const types = requested.filter(canViewDocument)
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
    'payment:openDocuments': (_evt, payload) => {
      const { type, partnerId, docId } = payload as { type: 'receipt' | 'payment'; partnerId: number; docId?: number }
      return paymentSvc.openDocuments(type, Number(partnerId), docId === undefined ? undefined : Number(docId))
    },
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

  const backupIpc = createBackupIpc(getDb(), migrationsDir)
  backupIpc.autoBackup()
  registerIpc({
    'backup:now': () => backupIpc.backupNow(),
    'backup:pickDir': () => backupIpc.pickDir(),
    'backup:list': () => backupIpc.backupList(),
    'backup:restore': (_evt, payload) => backupIpc.restoreBackup(String(payload)),
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
      userSvc.create(payload as { username: string; password: string; role: string }),
    'user:update': (_evt, payload) => {
      const { id, patch } = payload as {
        id: number
        patch: { password?: string; role?: string; disabled?: number | boolean }
      }
      return userSvc.update(Number(id), patch)
    },
    'user:remove': (_evt, payload) => {
      userSvc.remove(Number(payload))
      return true
    },
    // 角色（RBAC）：自定义角色的增删改查，权限点由 roleHas 判定
    'role:list': () => userSvc.listRoles(),
    'role:create': (_evt, payload) => {
      const { name, permissions } = payload as { name: string; permissions: string[] }
      return userSvc.createRole({
        name: String(name ?? ''),
        permissions: (Array.isArray(permissions) ? permissions : []).filter(isPermissionKey)
      })
    },
    'role:update': (_evt, payload) => {
      const { id, patch } = payload as {
        id: string
        patch: { name?: string; permissions?: string[] }
      }
      const next: Partial<RoleInput> = {}
      if (patch?.name !== undefined) next.name = String(patch.name)
      if (patch?.permissions !== undefined) {
        next.permissions = (Array.isArray(patch.permissions) ? patch.permissions : []).filter(isPermissionKey)
      }
      return userSvc.updateRole(String(id), next)
    },
    'role:remove': (_evt, payload) => {
      userSvc.removeRole(String(payload))
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
