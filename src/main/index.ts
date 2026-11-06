import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { openDb } from './db'
import { registerIpc } from './ipc/register'
import { createProductService } from './services/product/product.service'

// Migrations dir: in dev the source tree exists, so resolve from app path.
// After packaging (Task 11), copy src/main/db/migrations into resources and use process.resourcesPath.
const migrationsDir = app.isPackaged
  ? join(process.resourcesPath(), 'migrations')
  : join(app.getAppPath(), 'src/main/db/migrations')

let productService: ReturnType<typeof createProductService> | null = null
function getProductService(): ReturnType<typeof createProductService> {
  if (!productService) {
    const { userData } = app
    productService = createProductService(openDb(join(userData, 'zhjs-erp.db'), migrationsDir))
  }
  return productService
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
    'product:get': (_evt, payload) => svc.get(Number(payload)),
    'product:query': (_evt, payload) => svc.query(payload as never),
    'product:disable': (_evt, payload) => svc.disable(Number(payload)),
    'product:enable': (_evt, payload) => svc.enable(Number(payload))
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
