<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import brandIcon from '../assets/hesora.svg'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElNotification } from 'element-plus'
import { currentUser, hasPermission, logout } from '../stores/auth'
import { updateApi } from '../api/update'
import ModuleTour from '../components/ModuleTour.vue'
import { roleDisplayName, type PermissionKey } from '../../../shared/permissions'
import { closeAll, closeOthers, closeTab, openTab, restoreTabs, tabs, activeKey } from '../stores/tabs'

const route = useRoute()
const router = useRouter()
const isDemo = new URLSearchParams(window.location.search).get('mode') === 'demo'

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

const home: MenuItem = { path: '/', label: '经营概况', perm: 'report.dashboard' }

const groups: MenuGroup[] = [
  {
    key: 'masters-group',
    title: '商品与往来资料',
    items: [
      { path: '/product/list', label: '商品管理', perm: 'product.view' },
      { path: '/product/price-levels', label: '价格等级', perm: 'product.price' },
      { path: '/product/formulas', label: '配方档案', perm: 'product.view' },
      { path: '/customer/list', label: '客户', perm: 'customer.view' },
      { path: '/customer/price', label: '客户专属价', perm: 'customer.view' },
      { path: '/customer/price-by-product', label: '商品专属价', perm: 'product.view' },
      { path: '/product/attributes', label: '商品属性', perm: 'product.view' },
      { path: '/supplier/list', label: '供应商', perm: 'supplier.view' },
      { path: '/warehouse/list', label: '仓库', perm: 'warehouse.view' }
    ]
  },
  {
    key: 'purchase-group',
    title: '采购',
    perm: 'doc.purchase',
    items: [
      { path: '/purchase/edit', label: '开进货单', perm: 'doc.purchase' },
      { path: '/purchase/list', label: '进货单列表', perm: 'doc.purchase' },
      { path: '/purchase/return-edit', label: '开采购退货单', perm: 'doc.return' },
      { path: '/purchase/return-list', label: '采购退货单列表', perm: 'doc.return' },
      { path: '/purchase/suggestion', label: '采购建议', perm: 'inventory.report' }
    ]
  },
  {
    key: 'sale-group',
    title: '销售',
    perm: 'doc.sale',
    items: [
      { path: '/sale/edit', label: '开销售单', perm: 'doc.sale' },
      { path: '/sale/list', label: '销售单列表', perm: 'doc.sale' },
      { path: '/doc/workflow', label: '报价与订单审核', perm: 'doc.workflow' },
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
    title: '资金与对账',
    perm: 'doc.payment',
    items: [
      { path: '/payment/receipt', label: '收款单', perm: 'doc.payment' },
      { path: '/payment/payment', label: '付款单', perm: 'doc.payment' },
      { path: '/payment/list', label: '收付款列表', perm: 'doc.payment' },
      { path: '/stats/arrears', label: '应收应付', perm: 'report.arrears' },
      { path: '/stats/aging', label: '账龄报表', perm: 'report.arrears' },
      { path: '/account/ledger', label: '资金余额与转账', perm: 'fund.edit' },
      { path: '/account/list', label: '资金账户', perm: 'fund.view' }
    ]
  },
  {
    key: 'inventory-group',
    title: '库存',
    perm: 'inventory.view',
    items: [
      { path: '/inventory/statistics', label: '库存汇总', perm: 'inventory.view' },
      { path: '/inventory/detail', label: '库存明细', perm: 'inventory.report' },
      { path: '/inventory/cost-change', label: '成本变动明细', perm: 'inventory.report' },
      { path: '/inventory/flow', label: '库存流水', perm: 'inventory.report' },
      { path: '/inventory/warning', label: '库存预警', perm: 'inventory.report' },
      { path: '/product/quality', label: '保质期查询', perm: 'product.shelf' },
      { path: '/inventory/serial', label: '序列号台账', perm: 'inventory.serial' },
      { path: '/inventory/serial-flow', label: '序列号流水', perm: 'inventory.serial' },
      { path: '/inventory/price-adjust', label: '调整售价', perm: 'inventory.price' },
      { path: '/transfer/edit', label: '开调拨单', perm: 'inventory.adjust' },
      { path: '/transfer/list', label: '调拨单列表', perm: 'inventory.adjust' },
      { path: '/stocktake/edit', label: '开盘点单', perm: 'inventory.adjust' },
      { path: '/stocktake/list', label: '盘点单列表', perm: 'inventory.adjust' },
      { path: '/assemble/edit', label: '开组装拆卸单', perm: 'inventory.assemble' },
      { path: '/assemble/list', label: '组装拆卸单列表', perm: 'inventory.assemble' },
      { path: '/inventory/internal-use/new', label: '开内部领用单', perm: 'inventory.adjust' },
      { path: '/inventory/internal-use', label: '内部领用单列表', perm: 'inventory.adjust' }
    ]
  },
  {
    key: 'stats-group',
    title: '经营分析',
    perm: 'report.docSearch',
    items: [
      { path: '/stats/business', label: '经营报表', perm: 'report.business' },
      { path: '/stats/operator', label: '员工业绩', perm: 'report.business' },
      { path: '/stats/monthly', label: '月度库存汇总', perm: 'report.business' },
      { path: '/stats/hotsale', label: '热销榜', perm: 'report.business' },
      { path: '/stats/calendar', label: '销售日历', perm: 'report.business' },
      { path: '/stats/statement', label: '客商对账单', perm: 'report.arrears' },
      { path: '/stats/aging', label: '账龄分析', perm: 'report.arrears' },
      { path: '/doc/search', label: '单据查询', perm: 'report.docSearch' }
    ]
  },
  {
    key: 'system-group',
    title: '系统与数据',
    items: [
      { path: '/opening', label: '期初建账', perm: 'opening.edit' },
      { path: '/setting', label: '设置', perm: 'system.setting' },
      { path: '/setting/categories', label: '收支科目', perm: 'system.setting' },
      { path: '/setting/flow-categories', label: '进出类别', perm: 'system.setting' },
      { path: '/setting/print-templates', label: '打印模板', perm: 'system.setting' },
      { path: '/system/users', label: '用户管理', perm: 'system.user' },
      { path: '/system/roles', label: '角色权限', perm: 'system.role' },
      { path: '/sync', label: '同步备份', perm: 'data.sync' },
      // v1.3 Task 8: LAN 主机（本机管理功能，host:* 通道 IPC 端另有 admin 守卫）
      { path: '/host/connect', label: '设备配对', perm: 'system.setting' },
      { path: '/host/devices', label: '已配对设备', perm: 'system.setting' },
      // v1.4 T9：客户端连接（本机作为客户端加入主机协作）
      { path: '/system/client-connect', label: '客户端连接', perm: 'system.setting' },
      { path: '/guide?replay=1', label: '重新查看引导' },
      { path: '/about', label: '关于禾序' }
    ]
  }
]

const activeGroup = computed(() => groups.find((g) => g.items.some((item) => item.path === route.path))?.key)
// T8 双审 B5：管理类菜单（host/*、system/*、setting*、sync、opening）额外要求 admin，
// 与 IPC host:* role==='admin' 守卫一致。
const ADMIN_PREFIXES = ['/host', '/system', '/setting', '/sync', '/opening']
function itemVisible(item: { path: string; perm?: PermissionKey }): boolean {
  if (item.perm && !hasPermission(item.perm)) return false
  if (ADMIN_PREFIXES.some((p) => item.path === p || item.path.startsWith(p + '/'))) {
    return currentUser.value?.role === 'admin'
  }
  return true
}
const visibleGroups = computed(() =>
  groups
    .filter((g) => g.items.some(itemVisible))
    .map((g) => ({ ...g, items: g.items.filter(itemVisible) }))
)

// 提示式更新：每天最多检查一次，有新版本时弹通知，点击"下载"用系统浏览器打开。
// manifest 提供 sha256 时展示前 8 位 + 复制全文（供下载后核对安装包完整性）。
async function notifyUpdate() {
  const r = await updateApi.checkDaily()
  if (r && r.hasUpdate) {
    const notifyMessage = () =>
      h('div', [
        h('div', r.notes || `新版本 ${r.latestVersion ?? ''} 已发布`),
        r.sha256
          ? h('div', { style: 'margin-top:6px;font-size:12px;opacity:.8' }, [
              h('span', `SHA-256: ${r.sha256.slice(0, 8)}… `),
              h(
                'a',
                {
                  href: '#',
                  onClick: (e: Event) => {
                    e.preventDefault()
                    e.stopPropagation() // 复制不要触发通知整体的"打开下载"行为
                    const text = r.sha256 ?? ''
                    if (!navigator.clipboard) {
                      ElMessage.warning('当前环境不支持剪贴板，请手动记录')
                      return
                    }
                    void navigator.clipboard
                      .writeText(text)
                      .then(() => ElMessage.success('已复制 SHA-256'))
                      .catch(() => ElMessage.warning('复制失败，请手动记录'))
                  }
                },
                '复制全文'
              )
            ])
          : null
      ])
    ElNotification({
      title: '发现新版本',
      message: notifyMessage(),
      type: 'info',
      duration: 0,
      onClick: () => {
        if (!r.downloadUrl) return
        // openUrl 失败（返回 false 或抛错）必须给用户明确反馈（AGENTS.md §5），
        // 且不能用 void 丢掉 Promise 造成未处理的 rejection。
        void updateApi
          .openUrl(r.downloadUrl)
          .then((ok) => {
            if (!ok) ElMessage.error('无法打开下载链接，请检查系统默认浏览器设置')
          })
          .catch(() => {
            ElMessage.error('无法打开下载链接，请稍后重试')
          })
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

// ── 多标签页 ────────────────────────────────────────────────
const contextMenuVisible = ref(false)
const contextMenuKey = ref('')
const contextMenuStyle = ref({ top: '0px', left: '0px' })

/** 路由变化时登记/激活标签（登录、引导、激活等非工作台页面不进标签栏） */
const TAB_EXCLUDED = new Set(['/login', '/activate', '/guide'])

watch(
  () => route.path,
  () => {
    if (TAB_EXCLUDED.has(route.path)) return
    openTab(route)
  },
  { immediate: true }
)

onMounted(() => {
  restoreTabs()
})

function onTabClick(key: string) {
  const tab = tabs.value.find((t) => t.key === key)
  if (!tab) return
  if (route.fullPath === tab.path) return
  void router.push(tab.path)
}

function onTabClose(key: string) {
  const idx = tabs.value.findIndex((t) => t.key === key)
  const closed = closeTab(key)
  if (!closed) return
  if (route.fullPath === closed.path) {
    const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? tabs.value[0]
    void router.push(next ? next.path : '/')
  }
}

function onTabContext(event: MouseEvent, key: string) {
  contextMenuKey.value = key
  contextMenuStyle.value = { top: `${event.clientY}px`, left: `${event.clientX}px` }
  contextMenuVisible.value = true
}

function closeContextMenu() {
  contextMenuVisible.value = false
}

function onContextCommand(cmd: 'close' | 'others' | 'all'): void {
  const key = contextMenuKey.value
  contextMenuVisible.value = false
  if (cmd === 'close') onTabClose(key)
  else if (cmd === 'others') {
    closeOthers(key)
    const tab = tabs.value.find((t) => t.key === key)
    if (tab) void router.push(tab.path)
  } else {
    closeAll()
    const home = tabs.value[0]
    if (home) void router.push(home.path)
  }
}
</script>

<template>
  <el-container class="main-layout">
    <el-aside width="216px" class="layout-aside">
      <div class="brand"><img :src="brandIcon" alt="禾序" /><div><strong>禾序进销存</strong><small>HESORA INVENTORY</small></div></div>
      <el-menu router :default-active="route.path" :default-openeds="activeGroup ? [activeGroup] : []" unique-opened class="layout-menu">
        <el-menu-item v-if="home.perm && hasPermission(home.perm)" :index="home.path">{{ home.label }}</el-menu-item>
        <el-sub-menu v-for="g in visibleGroups" :key="g.key" :index="g.key">
          <template #title>{{ g.title }}</template>
          <el-menu-item v-for="item in g.items" :key="item.path" :index="item.path">{{ item.label }}</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="layout-header">
        <div class="workspace-label"><span class="status-dot"></span>{{ isDemo ? '演示账套' : '本地工作台' }} <el-tag v-if="isDemo" type="warning" size="small">模拟数据</el-tag><span v-else class="workspace-caption">货有数，账有序。</span></div>
        <div class="user-area">
          <span class="user-name">{{ currentUser?.username }}</span>
          <span class="user-role">{{ roleDisplayName(currentUser) }}</span>
          <el-button size="small" text type="primary" @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <ModuleTour />
      <el-main class="layout-main">
        <div class="tab-bar" @click="closeContextMenu">
          <div
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-item"
            :class="{ active: tab.key === activeKey }"
            @click.stop="onTabClick(tab.key)"
            @contextmenu.prevent="onTabContext($event, tab.key)"
          >
            <span class="tab-title">{{ tab.title }}</span>
            <i v-if="tab.closable" class="tab-close" @click.stop="onTabClose(tab.key)">✕</i>
          </div>
        </div>
        <div class="tab-content">
          <router-view v-slot="{ Component, route: currentRoute }">
            <keep-alive :max="12">
              <component :is="Component" :key="currentRoute.path" />
            </keep-alive>
          </router-view>
        </div>
      </el-main>
    </el-container>

    <div
      v-if="contextMenuVisible"
      class="tab-context-menu"
      :style="contextMenuStyle"
      @click.stop="contextMenuVisible = false"
    >
      <div class="ctx-item" @click="onContextCommand('close')">关闭当前</div>
      <div class="ctx-item" @click="onContextCommand('others')">关闭其他</div>
      <div class="ctx-item" @click="onContextCommand('all')">关闭全部</div>
    </div>
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

.layout-main {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  flex: 0 0 auto;
  overflow-x: auto;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--el-border-color);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.tab-item:hover {
  background: var(--el-fill-color);
}

.tab-item.active {
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.tab-close {
  font-style: normal;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 0 2px;
  border-radius: 2px;
}

.tab-close:hover {
  color: var(--el-color-danger);
  background: var(--el-fill-color-dark);
}

.tab-context-menu {
  position: fixed;
  z-index: 3000;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  box-shadow: var(--el-box-shadow-light);
  padding: 4px 0;
  min-width: 120px;
}

.tab-content {
  flex: 1 1 auto;
  overflow: auto;
  padding: 16px;
}

.ctx-item {
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
}

.ctx-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
</style>
