import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/DashboardView.vue') },
  { path: '/product/list', name: 'product-list', component: () => import('./views/product/ProductListView.vue') },
  { path: '/product/edit/:id?', name: 'product-edit', component: () => import('./views/product/ProductEditView.vue') },
  { path: '/customer/list', name: 'customer-list', component: () => import('./views/customer/CustomerListView.vue') },
  { path: '/customer/edit/:id?', name: 'customer-edit', component: () => import('./views/customer/CustomerEditView.vue') },
  { path: '/supplier/list', name: 'supplier-list', component: () => import('./views/supplier/SupplierListView.vue') },
  { path: '/supplier/edit/:id?', name: 'supplier-edit', component: () => import('./views/supplier/SupplierEditView.vue') },
  { path: '/warehouse/list', name: 'warehouse-list', component: () => import('./views/WarehouseListView.vue') },
  { path: '/account/list', name: 'account-list', component: () => import('./views/AccountListView.vue') },
  { path: '/inventory/statistics', name: 'inventory-statistics', component: () => import('./views/InventoryStatisticsView.vue') },
  { path: '/setting', name: 'setting', component: () => import('./views/SettingView.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
