// v1.3 Task 2: IPC handler 表抽取。
// 把 index.ts 中可路由的 handler 平移为 { channel, handler } 数组，
// handler 函数体逐字节平移，仅将外部引用改为 deps.xxx / 本文件惰性 getter；
// print/csv/backup/sync/update 组涉及 dialog/BrowserWindow/更新器等
// Electron 生命周期对象，留在 index.ts 本地注册（v1.3 LAN 不路由到它们）。
import type { DB } from '../db'
import { BizError } from '../../shared/result'
import type { IpcHandler } from '../../shared/result'
import { can, getCurrentUser, setCurrentUser } from '../auth'
import { roleHas } from '../../shared/permissions'
import { isPermissionKey, type PermissionKey, type RoleInput } from '../../shared/permissions'
import { WORKFLOW_KINDS, type FulfillmentRequest, type WorkflowKind } from '../../shared/types/workflow'
import type { Product } from '../../shared/types/product'
import type { LicensePayload } from '../../shared/license'
import type { DocQuery, DocType } from '../../shared/types/doc'
import type { PaymentCreateInput, PaymentType } from '../../shared/types/payment'
import type { FundTransferInput } from '../../shared/types/fund-ledger'

import { createUserService, type SessionUser } from '../services/user/user.service'
import { createProductService } from '../services/product/product.service'
import { createProductAttributeService } from '../services/product/product-attribute.service'
import { createPriceLevelService } from '../services/product/price-level.service'
import { createCustomerPriceService } from '../services/product/customer-price.service'
import { createShelfLifeService } from '../services/product/shelf-life.service'
import { createCustomerService } from '../services/customer/customer.service'
import { createSupplierService } from '../services/supplier/supplier.service'
import { createWarehouseService } from '../services/warehouse/warehouse.service'
import { createFundService } from '../services/fund/fund.service'
import { createFundLedger } from '../services/fund/ledger.service'
import { createSettingService } from '../services/setting/setting.service'
import { emitHostEvent } from '../host/event-bus'

// T8 review I2: 单据/库存事件发射 helper——统一 {no} 摘要 shape，防止逐处内联再漏。
function emitDocChanged(no: string): void {
  emitHostEvent({ event: 'doc.changed', at: new Date().toISOString(), summary: { no } })
}
function emitInventoryChanged(no: string): void {
  emitHostEvent({ event: 'inventory.changed', at: new Date().toISOString(), summary: { no } })
}

import { createCategoryService } from '../services/setting/category.service'
import { createFormulaService } from '../services/product/formula.service'
import { createOpeningService } from '../services/opening/opening.service'
import { createInventoryService } from '../services/inventory/inventory.service'
import { createStockReportService } from '../services/inventory/stock-report.service'
import { createSerialService } from '../services/inventory/serial.service'
import { assertProEdition, assertFeature } from '../services/license-gate'
import { createPurchaseService } from '../services/purchase/purchase.service'
import { createSaleService } from '../services/sale/sale.service'
import { createRetailService } from '../services/retail/retail.service'
import { createDocService } from '../services/doc/doc.service'
import { createDocCopyService } from '../services/doc/copy.service'
import { createReversalService } from '../services/doc/reversal.service'
import { createPaymentService } from '../services/payment/payment.service'
import { createArrearsService } from '../services/stats/arrears.service'
import { createStatementService } from '../services/stats/statement.service'
import { createDashboardService } from '../services/stats/dashboard.service'
import { createReportService } from '../services/stats/report.service'
import { createMonthlyService } from '../services/stats/monthly.service'
import { createAttachmentService } from '../services/attachment/attachment.service'
import { createInternalUseService } from '../services/inventory/internal-use.service'
import { createFlowCategoryService } from '../services/setting/flow-category.service'
import { createProductImageService } from '../services/product/product-image.service'
import { createTransferService } from '../services/transfer/transfer.service'
import { createStocktakeService } from '../services/stocktake/stocktake.service'
import { createAssembleService } from '../services/assemble/assemble.service'
import { createPrintTemplateService, type TemplateInput } from '../services/print/template.service'
import { createWorkflowService } from '../services/workflow/workflow.service'
import { createAuditService, type AuditQuery } from '../services/audit/audit.service'
import type { createDesktopLicenseService } from '../license'

type LicenseService = ReturnType<typeof createDesktopLicenseService>

export interface HandlerDeps {
  /** 惰性数据库访问（index.ts getDb，含 restore/seed 副作用） */
  getDb(): DB
  /** 商品图片目录（userData/product-images） */
  productImagesDir(): string
  /** 单据附件目录（userData/attachments） */
  attachmentsDir(): string
  /** 演示数据重置（index.ts resetDemoData 包装，含 demo 模式判断） */
  resetDemoData(db: DB): boolean
  /** 桌面授权服务（index.ts initialize 中构建，含试用守卫状态） */
  licenseSvc(): LicenseService
  /** v1.4 授权门控：当前 licensePayload（index.ts verifyFormat 结果，激活后惰性取） */
  licensePayload(): LicensePayload | null
  /** 审计服务（index.ts initialize 中构建） */
  auditSvc(): ReturnType<typeof createAuditService>
}

// 服务惰性 getter 闭包状态：每个服务只创建一次（与 index.ts 原行为一致）。
interface HandlerCaches {
  productService?: ReturnType<typeof createProductService>
  inventoryService?: ReturnType<typeof createInventoryService>
  customerService?: ReturnType<typeof createCustomerService>
  supplierService?: ReturnType<typeof createSupplierService>
  warehouseService?: ReturnType<typeof createWarehouseService>
  fundService?: ReturnType<typeof createFundService>
  settingService?: ReturnType<typeof createSettingService>
  categoryService?: ReturnType<typeof createCategoryService>
  openingService?: ReturnType<typeof createOpeningService>
  purchaseService?: ReturnType<typeof createPurchaseService>
  saleService?: ReturnType<typeof createSaleService>
  retailService?: ReturnType<typeof createRetailService>
  transferService?: ReturnType<typeof createTransferService>
  stocktakeService?: ReturnType<typeof createStocktakeService>
  assembleService?: ReturnType<typeof createAssembleService>
  paymentService?: ReturnType<typeof createPaymentService>
  dashboardService?: ReturnType<typeof createDashboardService>
  arrearsService?: ReturnType<typeof createArrearsService>
  reportService?: ReturnType<typeof createReportService>
  workflowService?: ReturnType<typeof createWorkflowService>
}

export interface IpcChannelHandler { channel: string; handler: IpcHandler }

const documentPermissions: Record<DocType, PermissionKey> = {
  purchase: 'doc.purchase', purchase_return: 'doc.purchase', sale: 'doc.sale', sale_return: 'doc.sale',
  retail: 'doc.retail', transfer: 'inventory.adjust', stocktake: 'inventory.adjust',
  assemble: 'inventory.assemble', disassemble: 'inventory.assemble', receipt: 'doc.payment',
  payment: 'doc.payment', other_in: 'doc.payment', other_out: 'doc.payment',
  // P3：内部领用出库单——归库存组权限
  internal_use: 'inventory.adjust'
}

// 单据类型→权限键映射与判定（模块级，供本文件与 index.ts 本地 print:a4pdf 共用一份事实来源）
export function canViewDocument(type: DocType): boolean {
  return Object.hasOwn(documentPermissions, type) && can(documentPermissions[type])
}

export function buildAllHandlers(deps: HandlerDeps): IpcChannelHandler[] {
  const caches: HandlerCaches = {}

  function getDb(): DB {
    return deps.getDb()
  }
  function getProductService(): ReturnType<typeof createProductService> {
    if (!caches.productService) caches.productService = createProductService(getDb())
    return caches.productService
  }
  function getInventoryService(): ReturnType<typeof createInventoryService> {
    if (!caches.inventoryService) caches.inventoryService = createInventoryService(getDb())
    return caches.inventoryService
  }
  function getCustomerService(): ReturnType<typeof createCustomerService> {
    if (!caches.customerService) caches.customerService = createCustomerService(getDb())
    return caches.customerService
  }
  function getSupplierService(): ReturnType<typeof createSupplierService> {
    if (!caches.supplierService) caches.supplierService = createSupplierService(getDb())
    return caches.supplierService
  }
  function getWarehouseService(): ReturnType<typeof createWarehouseService> {
    if (!caches.warehouseService) caches.warehouseService = createWarehouseService(getDb())
    return caches.warehouseService
  }
  function getFundService(): ReturnType<typeof createFundService> {
    if (!caches.fundService) caches.fundService = createFundService(getDb())
    return caches.fundService
  }
  function getSettingService(): ReturnType<typeof createSettingService> {
    if (!caches.settingService) caches.settingService = createSettingService(getDb())
    return caches.settingService
  }
  function getCategoryService(): ReturnType<typeof createCategoryService> {
    if (!caches.categoryService) caches.categoryService = createCategoryService(getDb())
    return caches.categoryService
  }
  function getOpeningService(): ReturnType<typeof createOpeningService> {
    if (!caches.openingService) caches.openingService = createOpeningService(getDb())
    return caches.openingService
  }
  function getPurchaseService(): ReturnType<typeof createPurchaseService> {
    if (!caches.purchaseService) caches.purchaseService = createPurchaseService(getDb())
    return caches.purchaseService
  }
  function getSaleService(): ReturnType<typeof createSaleService> {
    if (!caches.saleService) caches.saleService = createSaleService(getDb())
    return caches.saleService
  }
  function getRetailService(): ReturnType<typeof createRetailService> {
    if (!caches.retailService) caches.retailService = createRetailService(getDb())
    return caches.retailService
  }
  function getTransferService(): ReturnType<typeof createTransferService> {
    if (!caches.transferService) caches.transferService = createTransferService(getDb())
    return caches.transferService
  }
  function getStocktakeService(): ReturnType<typeof createStocktakeService> {
    if (!caches.stocktakeService) caches.stocktakeService = createStocktakeService(getDb())
    return caches.stocktakeService
  }
  function getAssembleService(): ReturnType<typeof createAssembleService> {
    if (!caches.assembleService) caches.assembleService = createAssembleService(getDb())
    return caches.assembleService
  }
  function getPaymentService(): ReturnType<typeof createPaymentService> {
    if (!caches.paymentService) caches.paymentService = createPaymentService(getDb())
    return caches.paymentService
  }
  function getDashboardService(): ReturnType<typeof createDashboardService> {
    if (!caches.dashboardService) caches.dashboardService = createDashboardService(getDb())
    return caches.dashboardService
  }
  function getArrearsService(): ReturnType<typeof createArrearsService> {
    if (!caches.arrearsService) caches.arrearsService = createArrearsService(getDb())
    return caches.arrearsService
  }
  function getReportService(): ReturnType<typeof createReportService> {
    if (!caches.reportService) caches.reportService = createReportService(getDb())
    return caches.reportService
  }
  function getWorkflowService(): ReturnType<typeof createWorkflowService> {
    if (!caches.workflowService) caches.workflowService = createWorkflowService(getDb())
    return caches.workflowService
  }

  // 敏感操作审计：危险/敏感通道在执行后写 platform_log（AGENTS.md §5 红线要求）。
  const auditSvc = deps.auditSvc()
  const operator = (session?: unknown) => userFor(session)?.username
  const audit = (action: string, detail: string, before?: unknown, after?: unknown, session?: unknown): void => {
    auditSvc.record(
      action,
      operator(session),
      detail,
      before === undefined ? undefined : JSON.stringify(before),
      after === undefined ? undefined : JSON.stringify(after)
    )
  }

  const licenseSvc = deps.licenseSvc()
  const workflow = getWorkflowService()
  function workflowAllowed(session: unknown, kind: WorkflowKind): boolean {
    return WORKFLOW_KINDS.includes(kind) && canForUser(session, kind === 'purchase_order' || kind === 'purchase' ? 'doc.purchase' : 'doc.sale')
  }
  function workflowActor(session: unknown, kind: WorkflowKind): number {
    const user = userFor(session)
    if (!user || !canForUser(session, 'doc.workflow') || !workflowAllowed(session, kind)) throw new BizError('FORBIDDEN', '当前操作员无此类单据的工作流权限')
    return user.id
  }
  function reviewerId(session?: unknown): number {
    const user = userFor(session)
    if (user?.role !== 'admin') throw new BizError('FORBIDDEN', '只有管理员可以审核和转单')
    return user.id
  }

  const svc = getProductService()
  function visibleProduct<T extends Product | null>(product: T, session?: unknown): T {
    if (!product || userFor(session)?.role === 'admin') return product
    return { ...product, purchase_price: 0 }
  }

  const priceLevelSvc = createPriceLevelService(getDb())
  const shelfLifeSvc = createShelfLifeService(getDb())
  const customerPriceSvc = createCustomerPriceService(getDb())
  const productAttrSvc = createProductAttributeService(getDb())
  const customerSvc = getCustomerService()
  const supplierSvc = getSupplierService()
  const warehouseSvc = getWarehouseService()
  const fundSvc = getFundService()
  const ledger = createFundLedger(getDb())
  const visibleFund = (fund: ReturnType<typeof fundSvc.getById>, session?: unknown) =>
    fund && userFor(session)?.role !== 'admin' ? { ...fund, opening_balance: undefined } : fund
  const settingSvc = getSettingService()
  const categorySvc = getCategoryService()
  const formulaSvc = createFormulaService(getDb())
  const openingSvc = getOpeningService()
  const invSvc = getInventoryService()
  const stockReportSvc = createStockReportService(getDb())
  const serialSvc = createSerialService(getDb())
  const docSvc = createDocService(getDb())
  const docCopySvc = createDocCopyService(getDb())
  const docReversalSvc = createReversalService(getDb())

  function assertDocumentVisible(id: number, session?: unknown): void {
    const doc = docSvc.getById(id)
    if (!doc || !canForUser(session, documentPermissions[doc.type])) throw new BizError('NO_PERMISSION', '当前操作员没有权限查看此单据')
  }

  const purchaseSvc = getPurchaseService()
  const saleSvc = getSaleService()
  const retailSvc = getRetailService()
  const paymentSvc = getPaymentService()
  function paymentType(type: unknown): PaymentType {
    if (type === 'receipt' || type === 'payment' || type === 'other_in' || type === 'other_out') return type
    throw new BizError('VALIDATION', '资金单据类型无效')
  }

  const arrearsSvc = getArrearsService()
  const reportSvc = getReportService()
  // M 级功能：月度库存汇总
  const monthlySvc = createMonthlyService(getDb())
  // P1 功能 #1：客商对账单 + 账龄分析（复用 report.arrears 权限键）
  const statementSvc = createStatementService(getDb())
  const internalUseSvc = createInternalUseService(getDb())
  const flowCategorySvc = createFlowCategoryService(getDb())
  const productImageSvc = createProductImageService(getDb(), deps.productImagesDir())
  const attachmentSvc = createAttachmentService(getDb(), deps.attachmentsDir())
  const dashboardSvc = getDashboardService()
  const transferSvc = getTransferService()
  const stocktakeSvc = getStocktakeService()
  const assembleSvc = getAssembleService()
  const printTemplateSvc = createPrintTemplateService(getDb())
  const userSvc = createUserService(getDb())

  // ── v1.3 Task 3：session-aware dispatch ──
  // session 存在（LAN 网关路径）→ 按库中该 userId 解析会话（含自定义角色权限解码）；
  // session 为 undefined（本地 IPC 路径）→ 走原全局 currentUser，行为零变化。
  const userFor = (session?: unknown): SessionUser | null => {
    const userId = session && typeof session === 'object' && typeof (session as { userId?: unknown }).userId === 'number'
      ? (session as { userId: number }).userId
      : null
    if (userId === null) return getCurrentUser()
    return userSvc.sessionById(userId)
  }
  const canForUser = (session: unknown, permission: PermissionKey): boolean => {
    const u = userFor(session)
    return !!u && roleHas(u.role, permission, u.permissions)
  }

  const handlers: { channel: string; handler: IpcHandler }[] = [
    // ── license / trial ──
    { channel: 'license:check', handler: () => licenseSvc.getStatus() },
    { channel: 'license:activate', handler: (_evt, payload) => licenseSvc.activate(String(payload)) },
    { channel: 'license:activateOnline', handler: (_evt, payload) => licenseSvc.activateOnline(String(payload)) },
    { channel: 'trial:check', handler: () => licenseSvc.getStatus() },
    { channel: 'trial:extend', handler: () => {
      licenseSvc.extendTrial()
      audit('trial.extend', '试用本地延期 7 天（trial_extended=1）')
      return licenseSvc.getStatus()
    } },
    { channel: 'trial:resetDemo', handler: () => {
      const ok = deps.resetDemoData(getDb())
      audit('trial.resetDemo', '重置演示数据为初始演示态（试用计时不受影响）')
      return ok
    } },

    // ── workflow ──
    { channel: 'workflow:list', handler: (_evt, payload, session) => {
      const { page, kind } = payload as { page?: number; kind?: WorkflowKind }
      return workflow.list(page, kind, WORKFLOW_KINDS.filter((k) => workflowAllowed(session, k)))
    } },
    { channel: 'workflow:save', handler: (_evt, payload, session) => {
      const input = payload as Parameters<typeof workflow.save>[0]
      if (input.id !== undefined) workflowActor(session, workflow.get(input.id).kind)
      return workflow.save(input, workflowActor(session, input.kind))
    } },
    { channel: 'workflow:approve', handler: (_evt, payload, session) => {
      const id = Number(payload)
      return workflow.approve(id, workflowActor(session, workflow.get(id).kind))
    } },
    { channel: 'workflow:convert', handler: (_evt, payload, session) => {
      const { id, target, quantities } = payload as { id: number; target?: WorkflowKind; quantities?: FulfillmentRequest[] }
      return workflow.convert(id, workflowActor(session, workflow.get(id).kind), target, quantities)
    } },
    { channel: 'workflow:cancel', handler: (_evt, payload, session) => {
      const id = Number(payload)
      return workflow.cancel(id, workflowActor(session, workflow.get(id).kind))
    } },

    // ── product ──
    { channel: 'product:create', handler: (_evt, payload) => { const created = svc.create(payload as never); emitHostEvent({ event: 'master.changed', at: new Date().toISOString(), summary: { id: created } }); return created } },
    { channel: 'product:update', handler: (_evt, payload, session) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      getDb().transaction(() => {
        const before = svc.getById(id)
        svc.update(id, p)
        const after = svc.getById(id)
        if (before && after && (before.retail_price !== after.retail_price || before.trade_price !== after.trade_price || before.purchase_price !== after.purchase_price)) {
          const prices = (product: Product) => JSON.stringify({ retail: product.retail_price, trade: product.trade_price, purchase: product.purchase_price })
          auditSvc.record('product.price', userFor(session)?.username, after.code, prices(before), prices(after))
        }
      })()
    } },
    { channel: 'product:get', handler: (_evt, payload, session) => visibleProduct(svc.getById(Number(payload)), session) },
    { channel: 'product:getByBarcode', handler: (_evt, payload, session) => visibleProduct(svc.getByBarcode(String(payload)), session) },
    { channel: 'product:query', handler: (_evt, payload, session) => {
      const result = svc.query(payload as never)
      return { ...result, list: result.list.map((p) => visibleProduct(p, session)) }
    } },
    { channel: 'product:disable', handler: (_evt, payload) => svc.disable(Number(payload)) },
    // S 级：商品成本映射（售价低于成本提醒用；复用 inventory.report 权限键）
    { channel: 'product:costMap', handler: (_evt, payload) => {
      const ids = payload as number[] | undefined
      return svc.costMap(Array.isArray(ids) ? ids.map(Number) : undefined)
    } },
    { channel: 'product:enable', handler: (_evt, payload) => svc.enable(Number(payload)) },
    // P3：批量修改（安全字段白名单），写操作日志
    { channel: 'product:bulkUpdate', handler: (_evt, payload, session) => {
      const { ids, patch } = payload as { ids: number[]; patch: Record<string, unknown> }
      const r = svc.bulkUpdate(ids, patch, userFor(session)?.username)
      const fields = Object.keys(patch).join(',')
      auditSvc.record(
        'product.bulk_update',
        userFor(session)?.username,
        `${r.updated} 个商品；ids=[${ids.join(',')}]；字段=${fields}`
      )
      return r
    } },

    // ── 价格等级 + 保质期/批次效期（商品主档增强）──
    { channel: 'product:priceLevels', handler: (_evt, payload) => {
      const { productId } = payload as { productId: number }
      return priceLevelSvc.getLevels(Number(productId))
    } },
    { channel: 'product:savePriceLevels', handler: (_evt, payload) => {
      const { productId, levels } = payload as { productId: number; levels: never[] }
      priceLevelSvc.setLevels(Number(productId), levels)
      return true
    } },
    { channel: 'product:setShelfLife', handler: (_evt, payload) => {
      // v1.4 serial_batch 门控：批次/效期为专业版专属
      assertFeature(deps.licensePayload(), 'serial_batch')
      const { productId, config } = payload as { productId: number; config: never }
      shelfLifeSvc.setShelfLife(Number(productId), config)
      return true
    } },
    { channel: 'product:batches', handler: (_evt, payload) => shelfLifeSvc.listBatches(payload as never) },
    { channel: 'product:saveBatch', handler: (_evt, payload) => {
      // v1.4 serial_batch 门控
      assertFeature(deps.licensePayload(), 'serial_batch')
      const { productId, warehouseId, batchNo, data } = payload as {
        productId: number
        warehouseId: number
        batchNo: string
        data?: { production_date?: string; expire_date?: string; remark?: string }
      }
      return shelfLifeSvc.ensureBatch(Number(productId), Number(warehouseId), String(batchNo ?? ''), data ?? {})
    } },

    // ── 客户×商品专属价 + 变价记录 ──
    { channel: 'customerPrice:set', handler: (_evt, payload, session) => {
      const { customerId, productId, price } = payload as {
        customerId: number
        productId: number
        price: number
      }
      return customerPriceSvc.setPrice(Number(customerId), Number(productId), price, userFor(session)?.username)
    } },
    { channel: 'customerPrice:remove', handler: (_evt, payload, session) => {
      const { customerId, productId } = payload as { customerId: number; productId: number }
      const before = customerPriceSvc.listByCustomer(Number(customerId)).find((p) => p.product_id === Number(productId))
      customerPriceSvc.removePrice(Number(customerId), Number(productId))
      audit('customerPrice:remove', `客户 ${customerId} 商品 ${productId}`, before ?? null, undefined, session)
      return true
    } },
    { channel: 'customerPrice:listByCustomer', handler: (_evt, payload) =>
      customerPriceSvc.listByCustomer(Number(payload)) },
    { channel: 'customerPrice:listByProduct', handler: (_evt, payload) => customerPriceSvc.listByProduct(Number(payload)) },
    { channel: 'customerPrice:changeLog', handler: (_evt, payload) =>
      customerPriceSvc.changeLog((payload ?? {}) as never) },

    // ── P2：商品自定义属性字典 ──
    { channel: 'productAttribute:list', handler: () => productAttrSvc.list() },
    { channel: 'productAttribute:create', handler: (_evt, payload) =>
      productAttrSvc.create(payload as { name: string; options?: string | string[] }) },
    { channel: 'productAttribute:update', handler: (_evt, payload) => {
      const { id, name, options } = payload as { id: number; name?: string; options?: string | string[] }
      return productAttrSvc.update(Number(id), { name, options })
    } },
    { channel: 'productAttribute:remove', handler: (_evt, payload, session) => {
      const id = Number(payload)
      productAttrSvc.remove(id)
      audit('productAttribute:remove', `属性 #${id}`, undefined, undefined, session)
      return true
    } },

    // ── customer ──
    { channel: 'customer:create', handler: (_evt, payload) => { const created = customerSvc.create(payload as never); emitHostEvent({ event: 'master.changed', at: new Date().toISOString(), summary: { id: created } }); return created } },
    { channel: 'customer:update', handler: (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      customerSvc.update(id, p)
    } },
    { channel: 'customer:get', handler: (_evt, payload) => customerSvc.getById(Number(payload)) },
    { channel: 'customer:query', handler: (_evt, payload) => customerSvc.query(payload as never) },
    { channel: 'customer:disable', handler: (_evt, payload) => customerSvc.disable(Number(payload)) },
    { channel: 'customer:enable', handler: (_evt, payload) => customerSvc.enable(Number(payload)) },
    { channel: 'customer:detail', handler: (_evt, payload) => customerSvc.getDetail(Number(payload)) },

    // ── supplier ──
    { channel: 'supplier:create', handler: (_evt, payload) => supplierSvc.create(payload as never) },
    { channel: 'supplier:update', handler: (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      supplierSvc.update(id, p)
    } },
    { channel: 'supplier:get', handler: (_evt, payload) => supplierSvc.getById(Number(payload)) },
    { channel: 'supplier:query', handler: (_evt, payload) => supplierSvc.query(payload as never) },
    { channel: 'supplier:disable', handler: (_evt, payload) => supplierSvc.disable(Number(payload)) },
    { channel: 'supplier:enable', handler: (_evt, payload) => supplierSvc.enable(Number(payload)) },

    // ── warehouse ──
    { channel: 'warehouse:create', handler: (_evt, payload) => {
      // v1.4 多仓门控：standard（resolveLicenseFeatures edition!=='professional'）下
      // 若 create 将导致 >1 个有效仓（现有仓数 ≥1）则拒绝 E_FEATURE_PRO；首仓允许。
      const existing = Number((getDb().prepare('SELECT COUNT(*) AS c FROM warehouse').get() as { c: number }).c)
      if (existing >= 1) assertProEdition(deps.licensePayload())
      return warehouseSvc.create(payload as never)
    } },
    { channel: 'warehouse:update', handler: (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      warehouseSvc.update(id, p)
    } },
    { channel: 'warehouse:get', handler: (_evt, payload) => warehouseSvc.getById(Number(payload)) },
    { channel: 'warehouse:query', handler: (_evt, payload) => warehouseSvc.query(payload as never) },
    { channel: 'warehouse:set-default', handler: (_evt, payload) => warehouseSvc.setDefault(Number(payload)) },
    { channel: 'warehouse:disable', handler: (_evt, payload) => warehouseSvc.disable(Number(payload)) },
    { channel: 'warehouse:enable', handler: (_evt, payload) => warehouseSvc.enable(Number(payload)) },

    // ── fund / ledger ──
    { channel: 'ledger:accounts', handler: () => ledger.accounts() },
    { channel: 'ledger:entries', handler: (_evt, payload) => {
      const { accountId, page } = payload as { accountId: number; page: number }
      return ledger.entries(accountId, page)
    } },
    { channel: 'ledger:transfer', handler: (_evt, payload, session) => {
      const fund = ledger.transfer(payload as FundTransferInput, reviewerId(session))
      auditSvc.record('ledger:transfer', operator(session), '资金账户转账', undefined, JSON.stringify(payload))
      return fund
    } },
    { channel: 'fund:create', handler: (_evt, payload) => fundSvc.create(payload as never) },
    { channel: 'fund:update', handler: (_evt, payload) => {
      const { id, p } = payload as { id: number; p: Record<string, unknown> }
      fundSvc.update(id, p)
    } },
    { channel: 'fund:get', handler: (_evt, payload, session) => visibleFund(fundSvc.getById(Number(payload)), session) },
    { channel: 'fund:query', handler: (_evt, payload, session) => {
      const result = fundSvc.query(payload as never)
      return { ...result, list: result.list.map((f) => visibleFund(f, session)) }
    } },
    { channel: 'fund:disable', handler: (_evt, payload) => fundSvc.disable(Number(payload)) },
    { channel: 'fund:enable', handler: (_evt, payload) => fundSvc.enable(Number(payload)) },

    // ── setting ──
    { channel: 'setting:get', handler: (_evt, payload) => settingSvc.get(String(payload)) },
    { channel: 'setting:set', handler: (_evt, payload) => {
      const { key, value } = payload as { key: string; value: string }
      settingSvc.set(key, value)
    } },
    { channel: 'setting:getAll', handler: () => settingSvc.getAll() },
    { channel: 'setting:remove', handler: (_evt, payload, session) => {
      const key = String(payload)
      const before = settingSvc.get(key)
      settingSvc.remove(key)
      audit('setting:remove', key, before ?? null, undefined, session)
    } },

    // ── v1.3 Task 8: LAN 主机配置（权限复用 system.setting；host_lan_enabled 默认 '0'）──
    // 写入后不热启：懒加载在主进程启动时判定，用户需重启应用生效。
    { channel: 'lan:getConfig', handler: () => ({ hostLanEnabled: settingSvc.get('host_lan_enabled') === '1' }) },
    { channel: 'lan:setConfig', handler: (_evt, payload, session) => {
      const { hostLanEnabled } = payload as { hostLanEnabled?: boolean }
      const value = hostLanEnabled ? '1' : '0'
      const before = settingSvc.get('host_lan_enabled') ?? '0'
      settingSvc.set('host_lan_enabled', value)
      audit('lan:setConfig', value, before, undefined, session)
    } },

    // ── 收支科目主档 ──
    { channel: 'category:list', handler: (_evt, payload) => {
      const q = (payload ?? {}) as { include_disabled?: boolean; kind?: 'income' | 'expense' }
      return categorySvc.list(q)
    } },
    { channel: 'category:create', handler: (_evt, input) => categorySvc.create(input as never) },
    { channel: 'category:update', handler: (_evt, payload) => {
      const { id, ...input } = payload as { id: number } & Record<string, unknown>
      return categorySvc.update(Number(id), input as never)
    } },
    { channel: 'category:remove', handler: (_evt, payload, session) => {
      const id = Number(payload)
      const before = categorySvc.list({}).find((c) => c.id === id)
      categorySvc.remove(id)
      audit('category:remove', `收支科目 #${id}`, before ?? null, undefined, session)
    } },
    { channel: 'category:disable', handler: (_evt, payload) => categorySvc.disable(Number(payload)) },
    { channel: 'category:enable', handler: (_evt, payload) => categorySvc.enable(Number(payload)) },

    // ── 配方档案（独立配方，组装单可选用）──
    { channel: 'formula:list', handler: (_evt, payload) => formulaSvc.list((payload ?? {}) as never) },
    { channel: 'formula:get', handler: (_evt, payload) => formulaSvc.getById(Number(payload)) },
    { channel: 'formula:create', handler: (_evt, payload) => formulaSvc.create(payload as never) },
    { channel: 'formula:update', handler: (_evt, payload) => {
      const { id, ...input } = payload as { id: number } & Record<string, unknown>
      formulaSvc.update(Number(id), input as never)
    } },
    { channel: 'formula:remove', handler: (_evt, payload, session) => {
      const id = Number(payload)
      const before = formulaSvc.getById(id)
      formulaSvc.remove(id)
      audit('formula:remove', `配方 #${id}${before ? ` ${before.name}` : ''}`, before ?? null, undefined, session)
    } },
    { channel: 'formula:disable', handler: (_evt, payload) => formulaSvc.disable(Number(payload)) },
    { channel: 'formula:enable', handler: (_evt, payload) => formulaSvc.enable(Number(payload)) },

    // ── opening ──
    { channel: 'opening:save', handler: (_evt, payload) => { openingSvc.save(payload as never); emitInventoryChanged('opening'); emitDocChanged('opening') } },
    { channel: 'opening:getStatus', handler: () => openingSvc.getStatus() },

    // ── inventory ──
    { channel: 'inventory:listCostLogs', handler: (_evt, payload) => invSvc.listCostLogs(Number(payload)) },
    { channel: 'inventory:queryStock', handler: (_evt, payload, session) => {
      const result = invSvc.queryStock(payload as never)
      if (userFor(session)?.role === 'admin') return result
      return { ...result, items: result.items.map((row) => ({ ...row, moving_cost: 0, amount: 0 })) }
    } },

    // ── 库存明细报表：统计明细/成本变动/库存流水/预警/批量调价 ──
    { channel: 'stock:statisticsDetail', handler: (_evt, payload) => stockReportSvc.statisticsDetail(payload as never) },
    { channel: 'stock:costChanges', handler: (_evt, payload) => stockReportSvc.costChanges(payload as never) },
    { channel: 'stock:flows', handler: (_evt, payload) => stockReportSvc.stockFlow(payload as never) },
    { channel: 'stock:warnings', handler: (_evt, payload) => stockReportSvc.warnings(payload as never) },
    // S 级：滞销商品（复用 inventory.report 权限键）
    { channel: 'stock:unsold', handler: (_evt, payload) =>
      stockReportSvc.unsold((payload ?? {}) as { days?: number; warehouse_id?: number }) },
    { channel: 'stock:setWarning', handler: (_evt, payload) => {
      const { product_id, min_stock } = payload as { product_id: number; min_stock: number }
      stockReportSvc.setWarning(Number(product_id), Number(min_stock))
      return true
    } },
    { channel: 'stock:setWarningsByCondition', handler: (_evt, payload) => {
      const { condition, min_stock } = payload as { condition: never; min_stock: number }
      return stockReportSvc.setWarningsByCondition(condition, Number(min_stock))
    } },
    { channel: 'stock:purchaseSuggestions', handler: (_evt, payload) =>
      stockReportSvc.purchaseSuggestions((payload ?? {}) as { warehouse_id?: number }) },
    { channel: 'stock:adjustPrices', handler: (_evt, payload, session) => {
      const { items, operator: op } = payload as { items: never[]; operator?: string }
      const r = stockReportSvc.adjustPrices(items, op)
      auditSvc.record('stock:adjustPrices', op ?? userFor(session)?.username, `批量改价 ${r.updated} 项`, undefined, JSON.stringify({ updated: r.updated, products: r.products }))
      return r
    } },

    // ── 序列号台账（v1.4 serial_batch 门控：写入通道拒 standard；查询通道放行避免前端死角）──
    { channel: 'serial:registerIn', handler: (_evt, payload) => { assertFeature(deps.licensePayload(), 'serial_batch'); return serialSvc.registerIn(payload as never) } },
    { channel: 'serial:consumeOut', handler: (_evt, payload) => { assertFeature(deps.licensePayload(), 'serial_batch'); return serialSvc.consumeOut(payload as never) } },
    { channel: 'serial:stock', handler: (_evt, payload) => serialSvc.listStock(payload as never) },
    { channel: 'serial:flows', handler: (_evt, payload) => serialSvc.listFlow(payload as never) },
    { channel: 'serial:validate', handler: (_evt, payload) => {
      const { sns, productId, direction } = payload as {
        sns: string[]
        productId: number
        direction?: 'in' | 'out'
      }
      return serialSvc.validateSns(Number(productId), sns, direction)
    } },
    { channel: 'serial:stockOf', handler: (_evt, payload) => serialSvc.stockOf(Number(payload)) },
    { channel: 'serial:trace', handler: (_evt, payload) => serialSvc.trace(String(payload)) },

    // ── 单据复制（再来一单）──
    { channel: 'doc:copy', handler: (_evt, payload, session) => {
      const { docId, overrides } = payload as { docId: number; overrides?: never }
      assertDocumentVisible(Number(docId), session)
      return docCopySvc.copy(Number(docId), overrides)
    } },

    // ── 已过账单据红冲（负向镜像单）──
    { channel: 'doc:reverse', handler: (_evt, payload, session) => {
      const { docId, operator: op } = payload as { docId: number; operator?: string }
      const id = Number(docId)
      assertDocumentVisible(id, session)
      const user = userFor(session)
      // LAN 会话下操作人强制为 session 用户（防伪造审计主体）；本地路径保留 payload 覆写权
      const actor = session ? user?.username : (op ?? user?.username)
      const rev = docReversalSvc.reverse(id, actor)
      auditSvc.record('doc.reverse', actor, `红冲单据 ${rev.no}`, undefined, JSON.stringify({ id: rev.id, reversal_of: id }))
      emitDocChanged(rev.no)
      emitInventoryChanged(rev.no)
      return rev
    } },
    { channel: 'doc:reversals', handler: (_evt, payload, session) => {
      assertDocumentVisible(Number(payload), session)
      return docReversalSvc.listReversals(Number(payload))
    } },

    // ── P2：直过账单据补审核（管理标记，不回滚账务）──
    { channel: 'doc:review', handler: (_evt, payload, session) => {
      const { docId, reviewer } = payload as { docId: number; reviewer?: string }
      const id = Number(docId)
      assertDocumentVisible(id, session)
      const user = userFor(session)
      const reviewed = docSvc.review(id, { reviewer: reviewer ?? user?.username ?? '' })
      auditSvc.record('doc.review', reviewer ?? user?.username, `补审核单据 ${reviewed.no}`, undefined, JSON.stringify({ id }))
      emitDocChanged(reviewed.no)
      return reviewed
    } },

    // ── purchase ──
    { channel: 'purchase:create', handler: (_evt, payload, session) => {
      if (!canForUser(session, 'doc.approve')) throw new BizError('FORBIDDEN', '请先保存进货草稿，由有审核权限的操作员过账')
      const created = purchaseSvc.create(payload as never)
      emitDocChanged(created.no)
      emitInventoryChanged(created.no)
      return created
    } },
    { channel: 'purchase:createReturn', handler: (_evt, payload) => { const created = purchaseSvc.createReturn(payload as never); emitDocChanged(created.no); emitInventoryChanged(created.no); return created } },
    { channel: 'purchase:getDetail', handler: (_evt, payload) => purchaseSvc.getDetail(Number(payload)) },
    { channel: 'purchase:query', handler: (_evt, payload) => purchaseSvc.query(payload as never) },

    // ── sale ──
    { channel: 'sale:create', handler: (_evt, payload, session) => {
      if (!canForUser(session, 'doc.approve')) throw new BizError('FORBIDDEN', '请先保存销售草稿，由有审核权限的操作员过账')
      // v1.4 serial_batch 门控：单据带 serial_numbers 时序列号出库为专业版专属
      const withSerial = (payload as { items?: { serial_numbers?: unknown[] }[] })?.items?.some((it) => Array.isArray(it.serial_numbers) && it.serial_numbers.length > 0)
      if (withSerial) assertFeature(deps.licensePayload(), 'serial_batch')
      const created = saleSvc.create(payload as never)
      emitDocChanged(created.no)
      emitInventoryChanged(created.no)
      return created
    } },
    { channel: 'sale:createReturn', handler: (_evt, payload) => { const created = saleSvc.createReturn(payload as never); emitDocChanged(created.no); emitInventoryChanged(created.no); return created } },
    { channel: 'sale:getDetail', handler: (_evt, payload) => saleSvc.getDetail(Number(payload)) },
    { channel: 'sale:query', handler: (_evt, payload) => saleSvc.query(payload as never) },

    // ── doc 查询/明细 ──
    { channel: 'doc:query', handler: (_evt, payload, session) => {
      const query = payload as DocQuery
      const requested = query.type ? [query.type] : query.types?.length ? query.types : Object.keys(documentPermissions) as DocType[]
      const types = requested.filter((t) => canForUser(session, documentPermissions[t]))
      return types.length ? docSvc.query({ ...query, type: undefined, types }) : { items: [], total: 0 }
    } },
    { channel: 'doc:detail', handler: (_evt, payload, session) => {
      const id = Number(payload)
      assertDocumentVisible(id, session)
      return docSvc.getDetailWithItems(id)
    } },

    // ── retail ──
    { channel: 'retail:create', handler: (_evt, payload, session) => { const u = userFor(session); if (!u) throw new BizError('VALIDATION', '请先登录'); const withSerial = (payload as { items?: { serial_numbers?: unknown[] }[] })?.items?.some((it) => Array.isArray(it.serial_numbers) && it.serial_numbers.length > 0); if (withSerial) assertFeature(deps.licensePayload(), 'serial_batch'); const created = retailSvc.create(payload as never, u.id); emitInventoryChanged(created.no); return created } },
    { channel: 'retail:hold', handler: (_evt, payload, session) => { const u = userFor(session); if (!u) throw new BizError('VALIDATION', '请先登录'); return retailSvc.hold(u.id, payload as never) } },
    { channel: 'retail:listHeld', handler: (_evt, _payload, session) => { const u = userFor(session); if (!u) throw new BizError('VALIDATION', '请先登录'); return retailSvc.listHeld(u.id) } },
    { channel: 'retail:discardHeld', handler: (_evt, payload, session) => { const u = userFor(session); if (!u) throw new BizError('VALIDATION', '请先登录'); return retailSvc.discardHeld(u.id, Number(payload)) } },
    { channel: 'retail:getDetail', handler: (_evt, payload) => retailSvc.getDetail(Number(payload)) },
    { channel: 'retail:query', handler: (_evt, payload) => retailSvc.query(payload as never) },

    // ── payment ──
    { channel: 'payment:openDocuments', handler: (_evt, payload) => {
      const { type, partnerId, docId } = payload as { type: 'receipt' | 'payment'; partnerId: number; docId?: number }
      return paymentSvc.openDocuments(type, Number(partnerId), docId === undefined ? undefined : Number(docId))
    } },
    { channel: 'payment:create', handler: (_evt, payload, session) => {
      const { type, p } = payload as { type: unknown; p: PaymentCreateInput }
      const created = paymentSvc.createOne(paymentType(type), p)
      auditSvc.record('payment:create', operator(session), `收款付款单 ${String(type)}`, undefined, JSON.stringify({ id: created.id, no: created.no }))
      emitDocChanged(created.no)
      return created
    } },
    { channel: 'payment:query', handler: (_evt, payload) => {
      const { type, q } = payload as { type: unknown; q: Omit<DocQuery, 'type'> }
      return paymentSvc.query(paymentType(type), q)
    } },
    { channel: 'payment:getDetail', handler: (_evt, payload) => {
      const { type, id } = payload as { type: unknown; id: number }
      return paymentSvc.getDetail(paymentType(type), id)
    } },
    { channel: 'payment:createReceipt', handler: (_evt, payload) => paymentSvc.createReceipt(payload as never) },
    { channel: 'payment:createPayment', handler: (_evt, payload) => paymentSvc.createPayment(payload as never) },
    { channel: 'payment:getReceiptDetail', handler: (_evt, payload) => paymentSvc.getReceiptDetail(Number(payload)) },
    { channel: 'payment:getPaymentDetail', handler: (_evt, payload) => paymentSvc.getPaymentDetail(Number(payload)) },
    { channel: 'payment:queryReceipt', handler: (_evt, payload) => paymentSvc.queryReceipt(payload as never) },
    { channel: 'payment:queryPayment', handler: (_evt, payload) => paymentSvc.queryPayment(payload as never) },

    // ── stats ──
    // P1 功能 #1：客商对账单明细 + 账龄分析
    { channel: 'stats:statement', handler: (_evt, payload) =>
      statementSvc.statement(payload as never) },
    { channel: 'stats:partnerAging', handler: (_evt, payload) =>
      statementSvc.aging(payload as never) },
    { channel: 'stats:receivables', handler: () => arrearsSvc.receivables() },
    { channel: 'stats:payables', handler: () => arrearsSvc.payables() },
    { channel: 'stats:summary', handler: () => arrearsSvc.summary() },
    { channel: 'stats:aging', handler: (_evt, payload) => arrearsSvc.aging((payload as { asOf?: string } | undefined)?.asOf) },
    { channel: 'stats:report', handler: (_evt, payload) => reportSvc.query(payload as never) },
    { channel: 'stats:operatorPerformance', handler: (_evt, payload) =>
      reportSvc.operatorPerformance(payload as never) },
    // [10] 科目资金汇总（S 级功能批次 B）
    { channel: 'stats:fundSummaryByCategory', handler: (_evt, payload) =>
      reportSvc.fundSummaryByCategory(
        (payload ?? {}) as { date_from?: string; date_to?: string }
      ) },
    // M 级功能：月度库存汇总表（复用 report.business 权限键）
    { channel: 'stats:monthlyStock', handler: (_evt, payload) => monthlySvc.monthlyStockSummary((payload ?? {}) as never) },
    // S 级：热销分析报表（复用 report.business 权限键）
    { channel: 'stats:hotSale', handler: (_evt, payload) =>
      reportSvc.hotSale(
        (payload ?? {}) as {
          date_from: string
          date_to: string
          top?: number
          warehouse_id?: number
        }
      ) },
    // P3：销售日历（复用 stats 服务与 report.business 权限键）
    { channel: 'stats:calendarSales', handler: (_evt, payload) =>
      getReportService().calendarSales((payload ?? {}) as { year: number; month: number }) },

    // ── P3：内部领用出库单（归库存组权限，带审计日志）──
    { channel: 'internalUse:create', handler: (_evt, payload, session) => {
      const doc = internalUseSvc.create(payload as never)
      auditSvc.record('internalUse:create', operator(session), `内部领用 ${doc.no}`, undefined, JSON.stringify({ id: doc.id }))
      return doc
    } },
    { channel: 'internalUse:getDetail', handler: (_evt, payload) => internalUseSvc.getDetail(Number(payload)) },
    { channel: 'internalUse:query', handler: (_evt, payload) => internalUseSvc.query((payload ?? {}) as never) },

    // ── P3：进出类别字典（系统设置权限）──
    { channel: 'flowCategory:list', handler: (_evt, payload) =>
      flowCategorySvc.list((payload ?? {}) as { kind?: 'in' | 'out'; include_disabled?: boolean }) },
    { channel: 'flowCategory:create', handler: (_evt, payload) =>
      flowCategorySvc.create((payload ?? {}) as { name: string; kind: 'in' | 'out' }) },
    { channel: 'flowCategory:update', handler: (_evt, payload) => {
      const { id, ...rest } = (payload ?? {}) as { id: number; name?: string; kind?: 'in' | 'out' }
      flowCategorySvc.update(Number(id), rest)
    } },
    { channel: 'flowCategory:remove', handler: (_evt, payload) => flowCategorySvc.remove(Number(payload)) },
    { channel: 'flowCategory:disable', handler: (_evt, payload) => flowCategorySvc.disable(Number(payload)) },
    { channel: 'flowCategory:enable', handler: (_evt, payload) => flowCategorySvc.enable(Number(payload)) },

    // ── P3：商品图片（≤3 张，目录由 main 注入，服务层不 import electron）──
    { channel: 'productImage:save', handler: (_evt, payload) =>
      productImageSvc.save((payload ?? {}) as { product_id: number; file_name: string; data: string }) },
    { channel: 'productImage:remove', handler: (_evt, payload) => {
      const { product_id, stored_name } = (payload ?? {}) as { product_id: number; stored_name: string }
      productImageSvc.remove(Number(product_id), String(stored_name))
    } },
    { channel: 'productImage:list', handler: (_evt, payload) =>
      productImageSvc.list(Number((payload as { product_id: number } | undefined)?.product_id)) },
    // 渲染层预览用：按相对文件名读回 {mime, data(base64)}
    { channel: 'productImage:read', handler: (_evt, payload) =>
      productImageSvc.read(String((payload as { stored_name: string } | undefined)?.stored_name)) },

    // ── M 级功能：单据图片附件（离线拍照留证）──
    { channel: 'attachment:save', handler: (_evt, payload) =>
      attachmentSvc.save(
        (payload ?? {}) as { doc_id: number; file_name: string; data: string; created_by?: number }
      ) },
    { channel: 'attachment:list', handler: (_evt, payload) =>
      attachmentSvc.listByDoc(Number((payload as { doc_id: number } | undefined)?.doc_id)) },
    { channel: 'attachment:remove', handler: (_evt, payload) =>
      attachmentSvc.remove(Number((payload as { id: number } | undefined)?.id)) },
    { channel: 'attachment:read', handler: (_evt, payload) =>
      attachmentSvc.read(Number((payload as { id: number } | undefined)?.id)) },

    // ── dashboard ──
    { channel: 'dashboard:summary', handler: (_evt, payload, session) => {
      const summary = dashboardSvc.summary(String(payload))
      return userFor(session)?.role === 'admin' ? summary : {
        ...summary, gross_profit: null, stock_amount: null, total_receivable: null, total_payable: null
      }
    } },
    { channel: 'dashboard:trend', handler: (_evt, payload) => {
      const { days } = (payload ?? {}) as { days?: number }
      return dashboardSvc.trend(Number(days) || 7)
    } },
    // [5] 日报速览（S 级功能批次 B）
    { channel: 'dashboard:todayBrief', handler: (_evt, payload) =>
      dashboardSvc.todayBrief(
        String((payload as { date?: string } | undefined)?.date ?? new Date().toISOString().slice(0, 10))
      ) },
    // [6] 首页待办提醒聚合（S 级功能批次 B）
    { channel: 'dashboard:reminders', handler: () => dashboardSvc.reminders() },

    // ── transfer ──
    { channel: 'transfer:create', handler: (_evt, payload, session) => {
      // v1.4 多仓门控：standard 下有效仓 >1（多仓场景）的调拨拒绝 E_FEATURE_PRO；单仓调拨无意义但保持一致口径。
      const activeWh = Number((getDb().prepare('SELECT COUNT(*) AS c FROM warehouse WHERE disabled=0').get() as { c: number }).c)
      if (activeWh > 1) assertProEdition(deps.licensePayload())
      const doc = transferSvc.create(payload as never)
      auditSvc.record('transfer:create', operator(session), `库存调拨 ${doc.no}`, undefined, JSON.stringify({ id: doc.id }))
      emitDocChanged(doc.no)
      emitInventoryChanged(doc.no)
      return doc
    } },
    { channel: 'transfer:getDetail', handler: (_evt, payload) => transferSvc.getDetail(Number(payload)) },
    { channel: 'transfer:query', handler: (_evt, payload) => transferSvc.query(payload as never) },

    // ── stocktake ──
    { channel: 'stocktake:getSheet', handler: (_evt, payload) => {
      const { warehouse_id, keyword } = payload as { warehouse_id: number; keyword?: string }
      return stocktakeSvc.getSheet(Number(warehouse_id), keyword)
    } },
    { channel: 'stocktake:create', handler: (_evt, payload, session) => {
      const doc = stocktakeSvc.create(payload as never)
      auditSvc.record('stocktake:create', operator(session), `盘点过账 ${doc.no}`, undefined, JSON.stringify({ id: doc.id }))
      emitDocChanged(doc.no)
      emitInventoryChanged(doc.no)
      return doc
    } },
    { channel: 'stocktake:review', handler: (_evt, payload, session) => {
      const { docId, review_by, review_remark } = payload as { docId: number; review_by?: string; review_remark?: string }
      const user = userFor(session)
      // LAN 会话下复盘人强制为 session 用户（防伪造审计主体）；本地路径保留 payload 覆写权
      const actor = session ? user?.username ?? '' : (review_by ?? user?.username ?? '')
      const reviewed = stocktakeSvc.review(Number(docId), {
        review_by: actor,
        review_remark
      })
      auditSvc.record('stocktake:review', actor, `盘点复盘 ${reviewed.no}`, undefined, JSON.stringify({ id: reviewed.id }))
      emitDocChanged(reviewed.no)
      return reviewed
    } },
    { channel: 'stocktake:getDetail', handler: (_evt, payload) => stocktakeSvc.getDetail(Number(payload)) },
    { channel: 'stocktake:query', handler: (_evt, payload) => stocktakeSvc.query(payload as never) },
    { channel: 'stocktake:importSheet', handler: (_evt, payload) => {
      const { csv_text, warehouse_id, date } = payload as {
        csv_text: string
        warehouse_id: number
        date?: string
      }
      return stocktakeSvc.importSheet(String(csv_text), {
        warehouse_id: Number(warehouse_id),
        date
      })
    } },

    // ── assemble ──
    { channel: 'assemble:create', handler: (_evt, payload) => { const created = assembleSvc.create(payload as never); emitDocChanged(created.no); emitInventoryChanged(created.no); return created } },
    { channel: 'assemble:disassemble', handler: (_evt, payload) => { const created = assembleSvc.disassemble(payload as never); emitDocChanged(created.no); emitInventoryChanged(created.no); return created } },
    { channel: 'assemble:getDetail', handler: (_evt, payload) => assembleSvc.getDetail(Number(payload)) },
    { channel: 'assemble:getDisassembleDetail', handler: (_evt, payload) => assembleSvc.getDisassembleDetail(Number(payload)) },
    { channel: 'assemble:query', handler: (_evt, payload) => assembleSvc.query(payload as never) },

    // ── print template ──
    { channel: 'printTemplate:list', handler: () => printTemplateSvc.list() },
    { channel: 'printTemplate:save', handler: (_evt, payload) => printTemplateSvc.save(payload as TemplateInput) },
    { channel: 'printTemplate:remove', handler: (_evt, payload) => printTemplateSvc.remove(Number(payload)) },
    { channel: 'printTemplate:setDefault', handler: (_evt, payload) => printTemplateSvc.setDefault(Number(payload)) },

    // ── audit ──
    { channel: 'audit:list', handler: () => auditSvc.list() },
    { channel: 'audit:query', handler: (_evt, payload) => auditSvc.query(payload as AuditQuery) },

    // ── auth / user / role ──
    { channel: 'auth:setupStatus', handler: () => userSvc.setupStatus() },
    { channel: 'auth:setup', handler: (_evt, payload) => {
      const { username, password } = payload as { username: string; password: string }
      const user = userSvc.setupAdmin(String(username), String(password))
      setCurrentUser(user)
      return user
    } },
    { channel: 'auth:login', handler: (_evt, payload) => {
      const { username, password } = payload as { username: string; password: string }
      const user = userSvc.verify(String(username), String(password))
      if (!user) return null
      setCurrentUser(user)
      return user
    } },
    { channel: 'auth:current', handler: () => getCurrentUser() },
    { channel: 'auth:logout', handler: () => {
      setCurrentUser(null)
      return true
    } },
    { channel: 'user:query', handler: () => userSvc.query() },
    { channel: 'user:get', handler: (_evt, payload) => userSvc.getById(Number(payload)) },
    { channel: 'user:create', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控：员工账号管理为专业版专属（admin 自身登录不受影响，仅拦管理通道）。
      assertFeature(deps.licensePayload(), 'rbac')
      const input = payload as { username: string; password: string; role: string }
      const created = userSvc.create(input)
      audit('user:create', `操作员 ${input.username} 角色 ${input.role}`, undefined, { username: created.username, role: created.role }, session)
      return created
    } },
    { channel: 'user:update', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控
      assertFeature(deps.licensePayload(), 'rbac')
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
        { role: patch.role, disabled: patch.disabled, passwordChanged: patch.password !== undefined },
        session
      )
      return result
    } },
    { channel: 'user:remove', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控
      assertFeature(deps.licensePayload(), 'rbac')
      const id = Number(payload)
      const before = userSvc.getById(id)
      userSvc.remove(id)
      audit('user:remove', `操作员 #${id}${before ? ` ${before.username}` : ''}`, before ? { username: before.username, role: before.role } : null, undefined, session)
      return true
    } },
    // 角色（RBAC）：自定义角色的增删改查，权限点由 roleHas 判定
    { channel: 'role:list', handler: () => userSvc.listRoles() },
    { channel: 'role:create', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控
      assertFeature(deps.licensePayload(), 'rbac')
      const { name, permissions } = payload as { name: string; permissions: string[] }
      const created = userSvc.createRole({
        name: String(name ?? ''),
        permissions: (Array.isArray(permissions) ? permissions : []).filter(isPermissionKey)
      })
      audit('role:create', `角色 ${name}`, undefined, { id: created }, session)
      return created
    } },
    { channel: 'role:update', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控
      assertFeature(deps.licensePayload(), 'rbac')
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
      audit('role:update', `角色 #${id}${patch?.name ? ` ${patch.name}` : ''}`, before, next, session)
      return result
    } },
    { channel: 'role:remove', handler: (_evt, payload, session) => {
      // v1.4 RBAC 门控
      assertFeature(deps.licensePayload(), 'rbac')
      const id = String(payload)
      const before = userSvc.listRoles().find((r) => r.id === id) ?? null
      userSvc.removeRole(id)
      audit('role:remove', `角色 ${id}`, before, undefined, session)
      return true
    } }
  ]

  return handlers
}
