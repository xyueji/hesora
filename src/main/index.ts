import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { openDb } from './db'
import { registerIpc } from './ipc/register'
import { createProductService } from './services/product/product.service'
import { createCustomerService } from './services/customer/customer.service'
import { createSupplierService } from './services/supplier/supplier.service'
import { createWarehouseService } from './services/warehouse/warehouse.service'
import { createFundService } from './services/fund/fund.service'
import { createSettingService } from './services/setting/setting.service'
import { createOpeningService } from './services/opening/opening.service'
import { createInventoryService } from './services/inventory/inventory.service'
import { createPurchaseService } from './services/purchase/purchase.service'
import { createSaleService } from './services/sale/sale.service'
import { createRetailService } from './services/retail/retail.service'
import { createPaymentService } from './services/payment/payment.service'
import { createArrearsService } from './services/stats/arrears.service'
import { createDashboardService } from './services/stats/dashboard.service'
import { createTransferService } from './services/transfer/transfer.service'
import { createStocktakeService } from './services/stocktake/stocktake.service'
import { createAssembleService } from './services/assemble/assemble.service'

// Migrations dir: in dev the source tree exists, so resolve from app path.
// After packaging (Task 11), copy src/main/db/migrations into resources and use process.resourcesPath.
// app.getPath('userData') instead of app.userData: tsconfig.node.json sets types:["node"],
// which suppresses electron's ambient declarations for the App interface.
const migrationsDir = app.isPackaged
  ? join(process.resourcesPath, 'migrations')
  : join(app.getAppPath(), 'src/main/db/migrations')

let productService: ReturnType<typeof createProductService> | null = null
function getProductService(): ReturnType<typeof createProductService> {
  if (!productService) {
    const userData = app.getPath('userData')
    productService = createProductService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return productService
}

let inventoryService: ReturnType<typeof createInventoryService> | null = null
function getInventoryService(): ReturnType<typeof createInventoryService> {
  if (!inventoryService) {
    const userData = app.getPath('userData')
    inventoryService = createInventoryService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return inventoryService
}

let customerService: ReturnType<typeof createCustomerService> | null = null
function getCustomerService(): ReturnType<typeof createCustomerService> {
  if (!customerService) {
    const userData = app.getPath('userData')
    customerService = createCustomerService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return customerService
}

let supplierService: ReturnType<typeof createSupplierService> | null = null
function getSupplierService(): ReturnType<typeof createSupplierService> {
  if (!supplierService) {
    const userData = app.getPath('userData')
    supplierService = createSupplierService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return supplierService
}

let warehouseService: ReturnType<typeof createWarehouseService> | null = null
function getWarehouseService(): ReturnType<typeof createWarehouseService> {
  if (!warehouseService) {
    const userData = app.getPath('userData')
    warehouseService = createWarehouseService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return warehouseService
}

let fundService: ReturnType<typeof createFundService> | null = null
function getFundService(): ReturnType<typeof createFundService> {
  if (!fundService) {
    const userData = app.getPath('userData')
    fundService = createFundService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return fundService
}

let settingService: ReturnType<typeof createSettingService> | null = null
function getSettingService(): ReturnType<typeof createSettingService> {
  if (!settingService) {
    const userData = app.getPath('userData')
    settingService = createSettingService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return settingService
}

let openingService: ReturnType<typeof createOpeningService> | null = null
function getOpeningService(): ReturnType<typeof createOpeningService> {
  if (!openingService) {
    const userData = app.getPath('userData')
    openingService = createOpeningService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return openingService
}

let purchaseService: ReturnType<typeof createPurchaseService> | null = null
function getPurchaseService(): ReturnType<typeof createPurchaseService> {
  if (!purchaseService) {
    const userData = app.getPath('userData')
    purchaseService = createPurchaseService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return purchaseService
}

let saleService: ReturnType<typeof createSaleService> | null = null
function getSaleService(): ReturnType<typeof createSaleService> {
  if (!saleService) {
    const userData = app.getPath('userData')
    saleService = createSaleService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return saleService
}

let retailService: ReturnType<typeof createRetailService> | null = null
function getRetailService(): ReturnType<typeof createRetailService> {
  if (!retailService) {
    const userData = app.getPath('userData')
    retailService = createRetailService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return retailService
}

let transferService: ReturnType<typeof createTransferService> | null = null
function getTransferService(): ReturnType<typeof createTransferService> {
  if (!transferService) {
    const userData = app.getPath('userData')
    transferService = createTransferService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return transferService
}

let stocktakeService: ReturnType<typeof createStocktakeService> | null = null
function getStocktakeService(): ReturnType<typeof createStocktakeService> {
  if (!stocktakeService) {
    const userData = app.getPath('userData')
    stocktakeService = createStocktakeService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return stocktakeService
}

let assembleService: ReturnType<typeof createAssembleService> | null = null
function getAssembleService(): ReturnType<typeof createAssembleService> {
  if (!assembleService) {
    const userData = app.getPath('userData')
    assembleService = createAssembleService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return assembleService
}

let paymentService: ReturnType<typeof createPaymentService> | null = null
function getPaymentService(): ReturnType<typeof createPaymentService> {
  if (!paymentService) {
    const userData = app.getPath('userData')
    paymentService = createPaymentService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return paymentService
}

let dashboardService: ReturnType<typeof createDashboardService> | null = null
function getDashboardService(): ReturnType<typeof createDashboardService> {
  if (!dashboardService) {
    const userData = app.getPath('userData')
    dashboardService = createDashboardService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return dashboardService
}

let arrearsService: ReturnType<typeof createArrearsService> | null = null
function getArrearsService(): ReturnType<typeof createArrearsService> {
  if (!arrearsService) {
    const userData = app.getPath('userData')
    arrearsService = createArrearsService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return arrearsService
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
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

app.whenReady().then(() => {
  const svc = getProductService()
  registerIpc({
    'product:create': (_evt, payload) => svc.create(payload as never),
    'product:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      svc.update(id, p)
    },
    'product:get': (_evt, payload) => svc.getById(Number(payload)),
    'product:query': (_evt, payload) => svc.query(payload as never),
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
  registerIpc({
    'fund:create': (_evt, payload) => fundSvc.create(payload as never),
    'fund:update': (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      fundSvc.update(id, p)
    },
    'fund:get': (_evt, payload) => fundSvc.getById(Number(payload)),
    'fund:query': (_evt, payload) => fundSvc.query(payload as never),
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
    'inventory:queryStock': (_evt, payload) => invSvc.queryStock(payload as never)
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
  registerIpc({
    'retail:create': (_evt, payload) => retailSvc.create(payload as never),
    'retail:getDetail': (_evt, payload) => retailSvc.getDetail(Number(payload)),
    'retail:query': (_evt, payload) => retailSvc.query(payload as never)
  })

  const paymentSvc = getPaymentService()
  registerIpc({
    'payment:createReceipt': (_evt, payload) => paymentSvc.createReceipt(payload as never),
    'payment:createPayment': (_evt, payload) => paymentSvc.createPayment(payload as never),
    'payment:getReceiptDetail': (_evt, payload) => paymentSvc.getReceiptDetail(Number(payload)),
    'payment:getPaymentDetail': (_evt, payload) => paymentSvc.getPaymentDetail(Number(payload)),
    'payment:queryReceipt': (_evt, payload) => paymentSvc.queryReceipt(payload as never),
    'payment:queryPayment': (_evt, payload) => paymentSvc.queryPayment(payload as never)
  })

  const arrearsSvc = getArrearsService()
  registerIpc({
    'stats:receivables': () => arrearsSvc.receivables(),
    'stats:payables': () => arrearsSvc.payables(),
    'stats:summary': () => arrearsSvc.summary()
  })

  const dashboardSvc = getDashboardService()
  registerIpc({
    'dashboard:summary': (_evt, payload) => dashboardSvc.summary(String(payload)),
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

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
