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
import { createAuditService, type AuditQuery } from './services/audit/audit.service'
import { BizError } from '../shared/result'
import { isPermissionKey, type PermissionKey, type RoleInput } from '../shared/permissions'
import { WORKFLOW_KINDS, type FulfillmentRequest, type WorkflowKind } from '../shared/types/workflow'
import { createProductService } from './services/product/product.service'
import { createProductAttributeService } from './services/product/product-attribute.service'
import { createPriceLevelService } from './services/product/price-level.service'
import { createCustomerPriceService } from './services/product/customer-price.service'
import { createShelfLifeService } from './services/product/shelf-life.service'
import { createCustomerService } from './services/customer/customer.service'
import { createSupplierService } from './services/supplier/supplier.service'
import { createWarehouseService } from './services/warehouse/warehouse.service'
import { createFundService } from './services/fund/fund.service'
import { createFundLedger } from './services/fund/ledger.service'
import { createSettingService } from './services/setting/setting.service'
import { createCategoryService } from './services/setting/category.service'
import { createFormulaService } from './services/product/formula.service'
import { createOpeningService } from './services/opening/opening.service'
import { createInventoryService } from './services/inventory/inventory.service'
import { createStockReportService } from './services/inventory/stock-report.service'
import { createSerialService } from './services/inventory/serial.service'
import { createPurchaseService } from './services/purchase/purchase.service'
import { createSaleService } from './services/sale/sale.service'
import { createRetailService } from './services/retail/retail.service'
import { createDocService } from './services/doc/doc.service'
import { createDocCopyService } from './services/doc/copy.service'
import { createReversalService } from './services/doc/reversal.service'
import { createPaymentService } from './services/payment/payment.service'
import { createArrearsService } from './services/stats/arrears.service'
import { createStatementService } from './services/stats/statement.service'
import { createDashboardService } from './services/stats/dashboard.service'
import { createReportService } from './services/stats/report.service'
import { createMonthlyService } from './services/stats/monthly.service'
import { createAttachmentService } from './services/attachment/attachment.service'
import { createTransferService } from './services/transfer/transfer.service'
import { createStocktakeService } from './services/stocktake/stocktake.service'
import { createAssembleService } from './services/assemble/assemble.service'
import { createPrintIpc } from './print'
import { createPrintTemplateService } from './services/print/template.service'
import type { TemplateInput } from './services/print/template.service'
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

let categoryService: ReturnType<typeof createCategoryService> | null = null
function getCategoryService(): ReturnType<typeof createCategoryService> {
  if (!categoryService) {
    categoryService = createCategoryService(getDb())
  }
  return categoryService
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

  // 客户×商品专属价 + 变价记录
  const customerPriceSvc = createCustomerPriceService(getDb())
  registerIpc({
    'customerPrice:set': (_evt, payload) => {
      const { customerId, productId, price } = payload as {
        customerId: number
        productId: number
        price: number
      }
      return customerPriceSvc.setPrice(Number(customerId), Number(productId), price, getCurrentUser()?.username)
    },
    'customerPrice:remove': (_evt, payload) => {
      const { customerId, productId } = payload as { customerId: number; productId: number }
      const before = customerPriceSvc.listByCustomer(Number(customerId)).find((p) => p.product_id === Number(productId))
      customerPriceSvc.removePrice(Number(customerId), Number(productId))
      audit('customerPrice:remove', `客户 ${customerId} 商品 ${productId}`, before ?? null)
      return true
    },
    'customerPrice:listByCustomer': (_evt, payload) =>
      customerPriceSvc.listByCustomer(Number(payload)),
    'customerPrice:listByProduct': (_evt, payload) => customerPriceSvc.listByProduct(Number(payload)),
    'customerPrice:changeLog': (_evt, payload) =>
      customerPriceSvc.changeLog((payload ?? {}) as never)
  })

  // P2：商品自定义属性字典
  const productAttrSvc = createProductAttributeService(getDb())
  registerIpc({
    'productAttribute:list': () => productAttrSvc.list(),
    'productAttribute:create': (_evt, payload) =>
      productAttrSvc.create(payload as { name: string; options?: string | string[] }),
    'productAttribute:update': (_evt, payload) => {
      const { id, name, options } = payload as { id: number; name?: string; options?: string | string[] }
      return productAttrSvc.update(Number(id), { name, options })
    },
    'productAttribute:remove': (_evt, payload) => {
      const id = Number(payload)
      productAttrSvc.remove(id)
      audit('productAttribute:remove', `属性 #${id}`)
      return true
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
    'customer:enable': (_evt, payload) => customerSvc.enable(Number(payload)),
    'customer:detail': (_evt, payload) => customerSvc.getDetail(Number(payload))
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
    'ledger:transfer': (_evt, payload) => {
      const fund = ledger.transfer(payload as FundTransferInput, reviewerId())
      auditSvc.record('ledger:transfer', operator(), '资金账户转账', undefined, JSON.stringify(payload))
      return fund
    },
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
    'setting:remove': (_evt, payload) => {
      const key = String(payload)
      const before = settingSvc.get(key)
      settingSvc.remove(key)
      audit('setting:remove', key, before ?? null)
    }
  })

  // 收支科目主档
  const categorySvc = getCategoryService()

  registerIpc({
    'category:list': (_evt, payload) => {
      const q = (payload ?? {}) as { include_disabled?: boolean; kind?: 'income' | 'expense' }
      return categorySvc.list(q)
    },
    'category:create': (_evt, input) => categorySvc.create(input as never),
    'category:update': (_evt, payload) => {
      const { id, ...input } = payload as { id: number } & Record<string, unknown>
      return categorySvc.update(Number(id), input as never)
    },
    'category:remove': (_evt, payload) => {
      const id = Number(payload)
      const before = categorySvc.list({}).find((c) => c.id === id)
      categorySvc.remove(id)
      audit('category:remove', `收支科目 #${id}`, before ?? null)
    },
    'category:disable': (_evt, payload) => categorySvc.disable(Number(payload)),
    'category:enable': (_evt, payload) => categorySvc.enable(Number(payload))
  })

  // 配方档案（独立配方，组装单可选用）
  const formulaSvc = createFormulaService(getDb())
  registerIpc({
    'formula:list': (_evt, payload) => formulaSvc.list((payload ?? {}) as never),
    'formula:get': (_evt, payload) => formulaSvc.getById(Number(payload)),
    'formula:create': (_evt, payload) => formulaSvc.create(payload as never),
    'formula:update': (_evt, payload) => {
      const { id, ...input } = payload as { id: number } & Record<string, unknown>
      formulaSvc.update(Number(id), input as never)
    },
    'formula:remove': (_evt, payload) => {
      const id = Number(payload)
      const before = formulaSvc.getById(id)
      formulaSvc.remove(id)
      audit('formula:remove', `配方 #${id}${before ? ` ${before.name}` : ''}`, before ?? null)
    },
    'formula:disable': (_evt, payload) => formulaSvc.disable(Number(payload)),
    'formula:enable': (_evt, payload) => formulaSvc.enable(Number(payload))
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
    'stock:purchaseSuggestions': (_evt, payload) =>
      stockReportSvc.purchaseSuggestions((payload ?? {}) as { warehouse_id?: number }),
    'stock:adjustPrices': (_evt, payload) => {
      const { items, operator } = payload as { items: never[]; operator?: string }
      const r = stockReportSvc.adjustPrices(items, operator)
      auditSvc.record('stock:adjustPrices', operator ?? getCurrentUser()?.username, `批量改价 ${r.updated} 项`, undefined, JSON.stringify({ updated: r.updated, products: r.products }))
      return r
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
    'serial:stockOf': (_evt, payload) => serialSvc.stockOf(Number(payload)),
    'serial:trace': (_evt, payload) => serialSvc.trace(String(payload))
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

  // 已过账单据红冲（负向镜像单）
  const docReversalSvc = createReversalService(getDb())
  registerIpc({
    'doc:reverse': (_evt, payload) => {
      const { docId, operator } = payload as { docId: number; operator?: string }
      const id = Number(docId)
      assertDocumentVisible(id)
      const user = getCurrentUser()
      const rev = docReversalSvc.reverse(id, operator ?? user?.username)
      auditSvc.record('doc.reverse', operator ?? user?.username, `红冲单据 ${rev.no}`, undefined, JSON.stringify({ id: rev.id, reversal_of: id }))
      return rev
    },
    'doc:reversals': (_evt, payload) => {
      assertDocumentVisible(Number(payload))
      return docReversalSvc.listReversals(Number(payload))
    }
  })

  // P2：直过账单据补审核（管理标记，不回滚账务）
  registerIpc({
    'doc:review': (_evt, payload) => {
      const { docId, reviewer } = payload as { docId: number; reviewer?: string }
      const id = Number(docId)
      assertDocumentVisible(id)
      const user = getCurrentUser()
      const reviewed = docSvc.review(id, { reviewer: reviewer ?? user?.username ?? '' })
      auditSvc.record('doc.review', reviewer ?? user?.username, `补审核单据 ${reviewed.no}`, undefined, JSON.stringify({ id }))
      return reviewed
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
      const created = paymentSvc.createOne(paymentType(type), p)
      auditSvc.record('payment:create', operator(), `收款付款单 ${String(type)}`, undefined, JSON.stringify({ id: created.id, no: created.no }))
      return created
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
  // M 级功能：月度库存汇总
  const monthlySvc = createMonthlyService(getDb())
  // P1 功能 #1：客商对账单 + 账龄分析（复用 report.arrears 权限键）
  const statementSvc = createStatementService(getDb())
  registerIpc({
    // P1 功能 #1：客商对账单明细 + 账龄分析
    'stats:statement': (_evt, payload) =>
      statementSvc.statement(payload as never),
    'stats:partnerAging': (_evt, payload) =>
      statementSvc.aging(payload as never),
    'stats:receivables': () => arrearsSvc.receivables(),
    'stats:payables': () => arrearsSvc.payables(),
    'stats:summary': () => arrearsSvc.summary(),
    'stats:aging': (_evt, payload) => arrearsSvc.aging((payload as { asOf?: string } | undefined)?.asOf),
    'stats:report': (_evt, payload) => reportSvc.query(payload as never),
    'stats:operatorPerformance': (_evt, payload) =>
      reportSvc.operatorPerformance(payload as never),
    // [10] 科目资金汇总（S 级功能批次 B）
    'stats:fundSummaryByCategory': (_evt, payload) =>
      reportSvc.fundSummaryByCategory(
        (payload ?? {}) as { date_from?: string; date_to?: string }
      ),
    // M 级功能：月度库存汇总表（复用 report.business 权限键）
    'stats:monthlyStock': (_evt, payload) => monthlySvc.monthlyStockSummary((payload ?? {}) as never)
  })

  // M 级功能：单据图片附件（离线拍照留证）。attachmentsDir 由 main 注入，服务层不 import electron。
  const attachmentSvc = createAttachmentService(
    getDb(),
    join(app.getPath('userData'), 'attachments')
  )
  registerIpc({
    'attachment:save': (_evt, payload) =>
      attachmentSvc.save(
        (payload ?? {}) as { doc_id: number; file_name: string; data: string; created_by?: number }
      ),
    'attachment:list': (_evt, payload) =>
      attachmentSvc.listByDoc(Number((payload as { doc_id: number } | undefined)?.doc_id)),
    'attachment:remove': (_evt, payload) =>
      attachmentSvc.remove(Number((payload as { id: number } | undefined)?.id)),
    'attachment:read': (_evt, payload) =>
      attachmentSvc.read(Number((payload as { id: number } | undefined)?.id))
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
    },
    // [5] 日报速览（S 级功能批次 B）
    'dashboard:todayBrief': (_evt, payload) =>
      dashboardSvc.todayBrief(
        String((payload as { date?: string } | undefined)?.date ?? new Date().toISOString().slice(0, 10))
      ),
    // [6] 首页待办提醒聚合（S 级功能批次 B）
    'dashboard:reminders': () => dashboardSvc.reminders()
  })

  const transferSvc = getTransferService()
  registerIpc({
    'transfer:create': (_evt, payload) => {
      const doc = transferSvc.create(payload as never)
      auditSvc.record('transfer:create', operator(), `库存调拨 ${doc.no}`, undefined, JSON.stringify({ id: doc.id }))
      return doc
    },
    'transfer:getDetail': (_evt, payload) => transferSvc.getDetail(Number(payload)),
    'transfer:query': (_evt, payload) => transferSvc.query(payload as never)
  })

  const stocktakeSvc = getStocktakeService()
  registerIpc({
    'stocktake:getSheet': (_evt, payload) => {
      const { warehouse_id, keyword } = payload as { warehouse_id: number; keyword?: string }
      return stocktakeSvc.getSheet(Number(warehouse_id), keyword)
    },
    'stocktake:create': (_evt, payload) => {
      const doc = stocktakeSvc.create(payload as never)
      auditSvc.record('stocktake:create', operator(), `盘点过账 ${doc.no}`, undefined, JSON.stringify({ id: doc.id }))
      return doc
    },
    'stocktake:review': (_evt, payload) => {
      const { docId, review_by, review_remark } = payload as { docId: number; review_by?: string; review_remark?: string }
      const user = getCurrentUser()
      const reviewed = stocktakeSvc.review(Number(docId), {
        review_by: review_by ?? user?.username ?? '',
        review_remark
      })
      auditSvc.record('stocktake:review', review_by ?? user?.username, `盘点复盘 ${reviewed.no}`, undefined, JSON.stringify({ id: reviewed.id }))
      return reviewed
    },
    'stocktake:getDetail': (_evt, payload) => stocktakeSvc.getDetail(Number(payload)),
    'stocktake:query': (_evt, payload) => stocktakeSvc.query(payload as never),
    'stocktake:importSheet': (_evt, payload) => {
      const { csv_text, warehouse_id, date } = payload as {
        csv_text: string
        warehouse_id: number
        date?: string
      }
      return stocktakeSvc.importSheet(String(csv_text), {
        warehouse_id: Number(warehouse_id),
        date
      })
    }
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

  const printTemplateSvc = createPrintTemplateService(getDb())
  registerIpc({
    'printTemplate:list': () => printTemplateSvc.list(),
    'printTemplate:save': (_evt, payload) => printTemplateSvc.save(payload as TemplateInput),
    'printTemplate:remove': (_evt, payload) => printTemplateSvc.remove(Number(payload)),
    'printTemplate:setDefault': (_evt, payload) => printTemplateSvc.setDefault(Number(payload))
  })

  const csvIpc = createCsvIpc(getDb())
  registerIpc({
    'audit:list': () => auditSvc.list(),
    'audit:query': (_evt, payload) => auditSvc.query(payload as AuditQuery),
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
    'user:create': (_evt, payload) => {
      const input = payload as { username: string; password: string; role: string }
      const created = userSvc.create(input)
      audit('user:create', `操作员 ${input.username} 角色 ${input.role}`, undefined, { username: created.username, role: created.role })
      return created
    },
    'user:update': (_evt, payload) => {
      const { id, patch } = payload as {
        id: number
        patch: { password?: string; role?: string; disabled?: number | boolean }
      }
      const before = userSvc.getById(Number(id))
      const result = userSvc.update(Number(id), patch)
      audit(
        'user:update',
        `操作员 #${id}`,
        before ? { role: before.role, disabled: before.disabled } : null,
        { role: patch.role, disabled: patch.disabled, passwordChanged: patch.password !== undefined }
      )
      return result
    },
    'user:remove': (_evt, payload) => {
      const id = Number(payload)
      const before = userSvc.getById(id)
      userSvc.remove(id)
      audit('user:remove', `操作员 #${id}${before ? ` ${before.username}` : ''}`, before ? { username: before.username, role: before.role } : null)
      return true
    },
    // 角色（RBAC）：自定义角色的增删改查，权限点由 roleHas 判定
    'role:list': () => userSvc.listRoles(),
    'role:create': (_evt, payload) => {
      const { name, permissions } = payload as { name: string; permissions: string[] }
      const created = userSvc.createRole({
        name: String(name ?? ''),
        permissions: (Array.isArray(permissions) ? permissions : []).filter(isPermissionKey)
      })
      audit('role:create', `角色 ${name}`, undefined, { id: created })
      return created
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
      const before = userSvc.listRoles().find((r) => r.id === String(id)) ?? null
      const result = userSvc.updateRole(String(id), next)
      audit('role:update', `角色 #${id}${patch?.name ? ` ${patch.name}` : ''}`, before, next)
      return result
    },
    'role:remove': (_evt, payload) => {
      const id = String(payload)
      const before = userSvc.listRoles().find((r) => r.id === id) ?? null
      userSvc.removeRole(id)
      audit('role:remove', `角色 ${id}`, before)
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
