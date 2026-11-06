import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { openDb } from './db'
import { registerIpc } from './ipc/register'
import { createProductService } from './services/product/product.service'
import { createCustomerService } from './services/customer/customer.service'
import { createSupplierService } from './services/supplier/supplier.service'

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
