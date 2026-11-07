import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/doc/workflow', name: 'doc-workflow', component: () => import('./views/doc/WorkflowView.vue'), meta: { title: '报价与订单审核' } },
  { path: '/about', name: 'about', component: () => import('./views/AboutView.vue'), meta: { title: '关于禾序' } },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { title: '登录' } },
  { path: '/guide', name: 'guide', component: () => import('./views/guide/GuideView.vue'), meta: { title: '新手引导' } },
  { path: '/activate', name: 'activate', component: () => import('./views/activate/ActivateView.vue'), meta: { title: '激活' } },
  { path: '/', name: 'home', component: () => import('./views/DashboardView.vue'), meta: { title: '经营概况' } },
  { path: '/product/list', name: 'product-list', component: () => import('./views/product/ProductListView.vue'), meta: { title: '商品管理' } },
  { path: '/product/edit/:id?', name: 'product-edit', component: () => import('./views/product/ProductEditView.vue'), meta: { title: '商品编辑' } },
  { path: '/customer/list', name: 'customer-list', component: () => import('./views/customer/CustomerListView.vue'), meta: { title: '客户' } },
  { path: '/customer/edit/:id?', name: 'customer-edit', component: () => import('./views/customer/CustomerEditView.vue'), meta: { title: '客户编辑' } },
  { path: '/supplier/list', name: 'supplier-list', component: () => import('./views/supplier/SupplierListView.vue'), meta: { title: '供应商' } },
  { path: '/supplier/edit/:id?', name: 'supplier-edit', component: () => import('./views/supplier/SupplierEditView.vue'), meta: { title: '供应商编辑' } },
  { path: '/warehouse/list', name: 'warehouse-list', component: () => import('./views/warehouse/WarehouseListView.vue'), meta: { title: '仓库' } },
  { path: '/warehouse/edit/:id?', name: 'warehouse-edit', component: () => import('./views/warehouse/WarehouseEditView.vue'), meta: { title: '仓库编辑' } },
  { path: '/account/list', name: 'account-list', component: () => import('./views/fund/FundAccountListView.vue'), meta: { title: '资金账户' } },
  { path: '/account/ledger', name: 'account-ledger', component: () => import('./views/fund/FundLedgerView.vue'), meta: { title: '资金余额与转账' } },
  { path: '/account/edit/:id?', name: 'account-edit', component: () => import('./views/fund/FundAccountEditView.vue'), meta: { title: '资金账户编辑' } },
  { path: '/purchase/list', name: 'purchase-list', component: () => import('./views/purchase/PurchaseListView.vue'), meta: { title: '进货单列表' } },
  { path: '/purchase/edit', name: 'purchase-edit', component: () => import('./views/purchase/PurchaseEditView.vue'), meta: { title: '开进货单' } },
  { path: '/purchase/return-edit', name: 'purchase-return-edit', component: () => import('./views/purchase/PurchaseReturnEditView.vue'), meta: { title: '开采购退货单' } },
  { path: '/purchase/return-list', name: 'purchase-return-list', component: () => import('./views/purchase/PurchaseReturnListView.vue'), meta: { title: '采购退货单列表' } },
  { path: '/sale/list', name: 'sale-list', component: () => import('./views/sale/SaleListView.vue'), meta: { title: '销售单列表' } },
  { path: '/sale/edit', name: 'sale-edit', component: () => import('./views/sale/SaleEditView.vue'), meta: { title: '开销售单' } },
  { path: '/sale/return-edit', name: 'sale-return-edit', component: () => import('./views/sale/SaleReturnEditView.vue'), meta: { title: '开销售退货单' } },
  { path: '/sale/return-list', name: 'sale-return-list', component: () => import('./views/sale/SaleReturnListView.vue'), meta: { title: '销售退货单列表' } },
  { path: '/retail/pos', name: 'retail-pos', component: () => import('./views/retail/RetailView.vue'), meta: { title: '快速零售' } },
  { path: '/retail/list', name: 'retail-list', component: () => import('./views/retail/RetailListView.vue'), meta: { title: '零售单列表' } },
  { path: '/payment/receipt', name: 'payment-receipt', component: () => import('./views/payment/ReceiptEditView.vue'), meta: { title: '收款单' } },
  { path: '/payment/payment', name: 'payment-payment', component: () => import('./views/payment/PaymentOnlyEditView.vue'), meta: { title: '付款单' } },
  { path: '/payment/list', name: 'payment-list', component: () => import('./views/payment/PaymentListView.vue'), meta: { title: '收付款列表' } },
  { path: '/transfer/list', name: 'transfer-list', component: () => import('./views/transfer/TransferListView.vue'), meta: { title: '调拨单列表' } },
  { path: '/transfer/edit', name: 'transfer-edit', component: () => import('./views/transfer/TransferEditView.vue'), meta: { title: '开调拨单' } },
  { path: '/stocktake/list', name: 'stocktake-list', component: () => import('./views/stocktake/StocktakeListView.vue'), meta: { title: '盘点单列表' } },
  { path: '/stocktake/edit', name: 'stocktake-edit', component: () => import('./views/stocktake/StocktakeEditView.vue'), meta: { title: '开盘点单' } },
  { path: '/assemble/list', name: 'assemble-list', component: () => import('./views/assemble/AssembleListView.vue'), meta: { title: '组装拆卸单列表' } },
  { path: '/assemble/edit', name: 'assemble-edit', component: () => import('./views/assemble/AssembleEditView.vue'), meta: { title: '开组装拆卸单' } },
  { path: '/inventory/statistics', name: 'inventory-statistics', redirect: '/inventory/stock', meta: { title: '库存汇总' } },
  { path: '/inventory/stock', name: 'inventory-stock', component: () => import('./views/inventory/StockListView.vue'), meta: { title: '库存汇总' } },
  { path: '/inventory/detail', name: 'inventory-detail', component: () => import('./views/inventory/StockDetailView.vue'), meta: { title: '库存明细' } },
  { path: '/inventory/cost-change', name: 'inventory-cost-change', component: () => import('./views/inventory/CostChangeView.vue'), meta: { title: '成本变动明细' } },
  { path: '/inventory/flow', name: 'inventory-flow', component: () => import('./views/inventory/StockFlowView.vue'), meta: { title: '库存流水' } },
  { path: '/inventory/warning', name: 'inventory-warning', component: () => import('./views/inventory/StockWarningView.vue'), meta: { title: '库存预警' } },
  { path: '/inventory/serial', name: 'inventory-serial', component: () => import('./views/inventory/SerialStockView.vue'), meta: { title: '序列号台账' } },
  { path: '/inventory/serial-flow', name: 'inventory-serial-flow', component: () => import('./views/inventory/SerialFlowView.vue'), meta: { title: '序列号流水' } },
  { path: '/inventory/price-adjust', name: 'inventory-price-adjust', component: () => import('./views/inventory/PriceAdjustView.vue'), meta: { title: '调整售价' } },
  { path: '/product/price-levels', name: 'product-price-levels', component: () => import('./views/product/ProductPriceLevelView.vue'), meta: { title: '价格等级' } },
  { path: '/product/quality', name: 'product-quality', component: () => import('./views/product/ProductQualityView.vue'), meta: { title: '保质期查询' } },
  { path: '/product/batches', name: 'product-batches', component: () => import('./views/product/ProductBatchListView.vue'), meta: { title: '批次效期' } },
  { path: '/stats/arrears', name: 'stats-arrears', component: () => import('./views/stats/ArrearsView.vue'), meta: { title: '应收应付' } },
  { path: '/stats/business', name: 'stats-business', component: () => import('./views/stats/BusinessReportView.vue'), meta: { title: '经营报表' } },
  { path: '/stats/operator', name: 'stats-operator', component: () => import('./views/stats/OperatorPerformanceView.vue'), meta: { title: '员工业绩' } },
  { path: '/doc/search', name: 'doc-search', component: () => import('./views/doc/DocSearchView.vue'), meta: { title: '单据查询' } },
  { path: '/opening', name: 'opening', component: () => import('./views/opening/OpeningView.vue'), meta: { title: '期初建账' } },
  { path: '/setting', name: 'setting', component: () => import('./views/setting/SettingView.vue'), meta: { title: '设置' } },
  { path: '/setting/categories', name: 'setting-categories', component: () => import('./views/setting/CategoryListView.vue'), meta: { title: '收支科目' } },
  { path: '/system/users', name: 'system-users', component: () => import('./views/system/UserListView.vue'), meta: { title: '用户管理' } },
  { path: '/system/roles', name: 'system-roles', component: () => import('./views/system/RoleListView.vue'), meta: { title: '角色权限' } },
  { path: '/sync', name: 'sync', component: () => import('./views/sync/SyncView.vue'), meta: { title: '同步备份' } }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 登录守卫：未登录一律跳到 /login（登录页除外）
router.beforeEach(async (to) => {
  const { currentUser, restoreSession } = await import('./stores/auth')
  if (currentUser.value === null) {
    try {
      await restoreSession()
    } catch {
      currentUser.value = null
    }
  }
  if (!currentUser.value && to.path !== '/login') return { path: '/login' }
  if (currentUser.value && to.path === '/login') return { path: '/' }
  // 试用到期强制进入激活页（license:check / auth:* 通道不受试用守卫限制）
  if (
    currentUser.value &&
    to.path !== '/activate' &&
    to.path !== '/guide'
  ) {
    try {
      const { licenseApi } = await import('./api/license')
      const s = await licenseApi.check()
      if (s.mode === 'trial' && s.daysLeft !== undefined && s.daysLeft <= 0) {
        return { path: '/activate' }
      }
    } catch {
      /* 检查失败不拦截（离线容错） */
    }
  }
  return true
})

export default router
