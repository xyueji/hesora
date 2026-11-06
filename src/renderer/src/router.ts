import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
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
  { path: '/account/edit/:id?', name: 'account-edit', component: () => import('./views/fund/FundAccountEditView.vue') },
  { path: '/purchase/list', name: 'purchase-list', component: () => import('./views/purchase/PurchaseListView.vue') },
  { path: '/purchase/edit', name: 'purchase-edit', component: () => import('./views/purchase/PurchaseEditView.vue') },
  { path: '/sale/list', name: 'sale-list', component: () => import('./views/sale/SaleListView.vue') },
  { path: '/sale/edit', name: 'sale-edit', component: () => import('./views/sale/SaleEditView.vue') },
  { path: '/retail/pos', name: 'retail-pos', component: () => import('./views/retail/RetailView.vue') },
  { path: '/retail/list', name: 'retail-list', component: () => import('./views/retail/RetailListView.vue') },
  { path: '/inventory/statistics', name: 'inventory-statistics', component: () => import('./views/InventoryStatisticsView.vue') },
  { path: '/inventory/stock', name: 'inventory-stock', component: () => import('./views/inventory/StockListView.vue') },
  { path: '/opening', name: 'opening', component: () => import('./views/opening/OpeningView.vue') },
  { path: '/setting', name: 'setting', component: () => import('./views/setting/SettingView.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
