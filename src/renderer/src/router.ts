import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/doc/workflow', name: 'doc-workflow', component: () => import('./views/doc/WorkflowView.vue') },
  { path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
  { path: '/guide', name: 'guide', component: () => import('./views/guide/GuideView.vue') },
  { path: '/activate', name: 'activate', component: () => import('./views/activate/ActivateView.vue') },
  { path: '/', name: 'home', component: () => import('./views/DashboardView.vue') },
  { path: '/product/list', name: 'product-list', component: () => import('./views/product/ProductListView.vue') },
  { path: '/product/edit/:id?', name: 'product-edit', component: () => import('./views/product/ProductEditView.vue') },
  { path: '/customer/list', name: 'customer-list', component: () => import('./views/customer/CustomerListView.vue') },
  { path: '/customer/edit/:id?', name: 'customer-edit', component: () => import('./views/customer/CustomerEditView.vue') },
  { path: '/supplier/list', name: 'supplier-list', component: () => import('./views/supplier/SupplierListView.vue') },
  { path: '/supplier/edit/:id?', name: 'supplier-edit', component: () => import('./views/supplier/SupplierEditView.vue') },
  { path: '/warehouse/list', name: 'warehouse-list', component: () => import('./views/warehouse/WarehouseListView.vue') },
  { path: '/warehouse/edit/:id?', name: 'warehouse-edit', component: () => import('./views/warehouse/WarehouseEditView.vue') },
  { path: '/account/list', name: 'account-list', component: () => import('./views/fund/FundAccountListView.vue') },
  { path: '/account/ledger', name: 'account-ledger', component: () => import('./views/fund/FundLedgerView.vue') },
  { path: '/account/edit/:id?', name: 'account-edit', component: () => import('./views/fund/FundAccountEditView.vue') },
  { path: '/purchase/list', name: 'purchase-list', component: () => import('./views/purchase/PurchaseListView.vue') },
  { path: '/purchase/edit', name: 'purchase-edit', component: () => import('./views/purchase/PurchaseEditView.vue') },
  { path: '/purchase/return-edit', name: 'purchase-return-edit', component: () => import('./views/purchase/PurchaseReturnEditView.vue') },
  { path: '/purchase/return-list', name: 'purchase-return-list', component: () => import('./views/purchase/PurchaseReturnListView.vue') },
  { path: '/sale/list', name: 'sale-list', component: () => import('./views/sale/SaleListView.vue') },
  { path: '/sale/edit', name: 'sale-edit', component: () => import('./views/sale/SaleEditView.vue') },
  { path: '/sale/return-edit', name: 'sale-return-edit', component: () => import('./views/sale/SaleReturnEditView.vue') },
  { path: '/sale/return-list', name: 'sale-return-list', component: () => import('./views/sale/SaleReturnListView.vue') },
  { path: '/retail/pos', name: 'retail-pos', component: () => import('./views/retail/RetailView.vue') },
  { path: '/retail/list', name: 'retail-list', component: () => import('./views/retail/RetailListView.vue') },
  { path: '/payment/receipt', name: 'payment-receipt', component: () => import('./views/payment/ReceiptEditView.vue') },
  { path: '/payment/payment', name: 'payment-payment', component: () => import('./views/payment/PaymentOnlyEditView.vue') },
  { path: '/payment/list', name: 'payment-list', component: () => import('./views/payment/PaymentListView.vue') },
  { path: '/transfer/list', name: 'transfer-list', component: () => import('./views/transfer/TransferListView.vue') },
  { path: '/transfer/edit', name: 'transfer-edit', component: () => import('./views/transfer/TransferEditView.vue') },
  { path: '/stocktake/list', name: 'stocktake-list', component: () => import('./views/stocktake/StocktakeListView.vue') },
  { path: '/stocktake/edit', name: 'stocktake-edit', component: () => import('./views/stocktake/StocktakeEditView.vue') },
  { path: '/assemble/list', name: 'assemble-list', component: () => import('./views/assemble/AssembleListView.vue') },
  { path: '/assemble/edit', name: 'assemble-edit', component: () => import('./views/assemble/AssembleEditView.vue') },
  { path: '/inventory/statistics', name: 'inventory-statistics', redirect: '/inventory/stock' },
  { path: '/inventory/stock', name: 'inventory-stock', component: () => import('./views/inventory/StockListView.vue') },
  { path: '/stats/arrears', name: 'stats-arrears', component: () => import('./views/stats/ArrearsView.vue') },
  { path: '/stats/business', name: 'stats-business', component: () => import('./views/stats/BusinessReportView.vue') },
  { path: '/doc/search', name: 'doc-search', component: () => import('./views/doc/DocSearchView.vue') },
  { path: '/opening', name: 'opening', component: () => import('./views/opening/OpeningView.vue') },
  { path: '/setting', name: 'setting', component: () => import('./views/setting/SettingView.vue') },
  { path: '/system/users', name: 'system-users', component: () => import('./views/system/UserListView.vue') },
  { path: '/sync', name: 'sync', component: () => import('./views/sync/SyncView.vue') }
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
