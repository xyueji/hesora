<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import brandIcon from '../assets/hesora.svg'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElNotification } from 'element-plus'
import { currentUser, hasPermission, logout } from '../stores/auth'
import { updateApi } from '../api/update'
import ModuleTour from '../components/ModuleTour.vue'
import type { PermissionKey } from '../../../shared/permissions'

const route = useRoute()
const router = useRouter()

// 菜单项 → 所需权限；无权限对当前用户隐藏。perm 缺省 = 所有人可见。
interface MenuItem {
  path: string
  label: string
  perm?: PermissionKey
}
interface MenuGroup {
  key: string
  title: string
  perm?: PermissionKey
  items: MenuItem[]
}

const plainItems: MenuItem[] = [
  { path: '/', label: '经营概况', perm: 'report.dashboard' },
  { path: '/doc/workflow', label: '报价与订单审核', perm: 'system.setting' },
  { path: '/product/list', label: '商品管理', perm: 'product.view' },
  { path: '/customer/list', label: '客户', perm: 'customer.view' },
  { path: '/supplier/list', label: '供应商', perm: 'supplier.view' },
  { path: '/warehouse/list', label: '仓库', perm: 'warehouse.view' },
  { path: '/account/list', label: '资金账户', perm: 'fund.view' },
  { path: '/opening', label: '期初建账', perm: 'opening.edit' },
  { path: '/about', label: '关于禾序' },
  { path: '/setting', label: '设置', perm: 'system.setting' },
  { path: '/system/users', label: '用户管理', perm: 'system.user' },
  { path: '/sync', label: '同步备份', perm: 'data.sync' },
  { path: '/guide?replay=1', label: '重新查看引导' }
]

const groups: MenuGroup[] = [
  {
    key: 'purchase-group',
    title: '采购',
    perm: 'doc.purchase',
    items: [
      { path: '/purchase/edit', label: '开进货单', perm: 'doc.purchase' },
      { path: '/purchase/list', label: '进货单列表', perm: 'doc.purchase' },
      { path: '/purchase/return-edit', label: '开采购退货单', perm: 'doc.return' },
      { path: '/purchase/return-list', label: '采购退货单列表', perm: 'doc.return' }
    ]
  },
  {
    key: 'sale-group',
    title: '销售',
    perm: 'doc.sale',
    items: [
      { path: '/sale/edit', label: '开销售单', perm: 'doc.sale' },
      { path: '/sale/list', label: '销售单列表', perm: 'doc.sale' },
      { path: '/sale/return-edit', label: '开销售退货单', perm: 'doc.return' },
      { path: '/sale/return-list', label: '销售退货单列表', perm: 'doc.return' }
    ]
  },
  {
    key: 'retail-group',
    title: '零售',
    perm: 'doc.retail',
    items: [
      { path: '/retail/pos', label: '快速零售', perm: 'doc.retail' },
      { path: '/retail/list', label: '零售单列表', perm: 'doc.retail' }
    ]
  },
  {
    key: 'payment-group',
    title: '资金',
    perm: 'doc.payment',
    items: [
      { path: '/payment/receipt', label: '收款单', perm: 'doc.payment' },
      { path: '/payment/payment', label: '付款单', perm: 'doc.payment' },
      { path: '/payment/list', label: '收付款列表', perm: 'doc.payment' },
      { path: '/account/ledger', label: '资金余额与转账', perm: 'fund.edit' }
    ]
  },
  {
    key: 'inventory-group',
    title: '库存',
    perm: 'inventory.view',
    items: [
      { path: '/inventory/statistics', label: '库存汇总', perm: 'inventory.view' },
      { path: '/transfer/edit', label: '开调拨单', perm: 'inventory.adjust' },
      { path: '/transfer/list', label: '调拨单列表', perm: 'inventory.adjust' },
      { path: '/stocktake/edit', label: '开盘点单', perm: 'inventory.adjust' },
      { path: '/stocktake/list', label: '盘点单列表', perm: 'inventory.adjust' },
      { path: '/assemble/edit', label: '开组装拆卸单', perm: 'inventory.assemble' },
      { path: '/assemble/list', label: '组装拆卸单列表', perm: 'inventory.assemble' }
    ]
  },
  {
    key: 'stats-group',
    title: '报表',
    perm: 'report.docSearch',
    items: [
      { path: '/stats/arrears', label: '应收应付', perm: 'report.arrears' },
      { path: '/stats/business', label: '经营报表', perm: 'report.business' },
      { path: '/doc/search', label: '单据查询', perm: 'report.docSearch' }
    ]
  }
]

const visiblePlain = computed(() => plainItems.filter((i) => !i.perm || hasPermission(i.perm)))
const visibleGroups = computed(() =>
  groups
    .filter((g) => g.items.some((i) => !i.perm || hasPermission(i.perm)))
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || hasPermission(i.perm)) }))
)

// 提示式更新：每天最多检查一次，有新版本时弹通知，点击"下载"用系统浏览器打开
async function notifyUpdate() {
  const r = await updateApi.checkDaily()
  if (r && r.hasUpdate) {
    ElNotification({
      title: '发现新版本',
      message: r.notes || `新版本 ${r.latestVersion ?? ''} 已发布`,
      type: 'info',
      duration: 0,
      onClick: () => {
        if (r.downloadUrl) void updateApi.openUrl(r.downloadUrl)
      }
    })
  }
}
let updateTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void notifyUpdate()
  updateTimer = setInterval(() => void notifyUpdate(), 60 * 60 * 1000)
})
onUnmounted(() => clearInterval(updateTimer))

async function onLogout() {
  try {
    await logout()
    ElMessage.success('已退出登录')
    void router.push('/login')
  } catch (e) {
    ElMessage.error((e as Error).message || '退出失败')
  }
}
</script>

<template>
  <el-container class="main-layout">
    <el-aside width="216px" class="layout-aside">
      <div class="brand"><img :src="brandIcon" alt="禾序" /><div><strong>禾序进销存</strong><small>HESORA INVENTORY</small></div></div>
      <el-menu router :default-active="route.path" class="layout-menu">
        <el-menu-item v-for="item in visiblePlain.filter((i) => i.path === '/')" :key="item.path" :index="item.path">
          {{ item.label }}
        </el-menu-item>
        <el-sub-menu v-for="g in visibleGroups" :key="g.key" :index="g.key">
          <template #title>{{ g.title }}</template>
          <el-menu-item v-for="item in g.items" :key="item.path" :index="item.path">{{ item.label }}</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-for="item in visiblePlain.filter((i) => i.path !== '/')" :key="item.path" :index="item.path">
          {{ item.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="layout-header">
        <div class="workspace-label"><span class="status-dot"></span>本地工作台 <span class="workspace-caption">货有数，账有序。</span></div>
        <div class="user-area">
          <span class="user-name">{{ currentUser?.username }}</span>
          <span class="user-role">{{ currentUser?.role === 'admin' ? '管理员' : '收银员' }}</span>
          <el-button size="small" text type="primary" @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <ModuleTour />
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.main-layout {
  height: 100vh;
}

.layout-aside {
  border-right: 1px solid var(--el-border-color);
}

.brand {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

.layout-menu {
  border-right: none;
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color);
}

.user-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  font-weight: 600;
}

.user-role {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
