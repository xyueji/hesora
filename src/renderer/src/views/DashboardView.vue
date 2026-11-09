<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dashboardApi, type DashboardSummary, type DashboardTrendRow, type ReminderItem, type TodayBrief } from '../api/dashboard'
import { licenseApi, type LicenseStatus } from '../api/license'

const $router = useRouter()

// 试用引导条：第 1-2 天 onboarding、第 3-4 天价值提示、第 5 天起剩余提醒+延期入口
const licenseStatus = ref<LicenseStatus | null>(null)
const extendingTrial = ref(false)
const TRIAL_BANNER_DISMISS_KEY = 'trial_banner_dismissed_v1'

const trialBanner = computed(() => {
  const s = licenseStatus.value
  if (!s || s.mode === 'licensed') return null
  const daysLeft = s.daysLeft ?? 0
  const elapsed = 14 - daysLeft // trial:7 / extended:14 总长
  if (s.phase === 'expired') {
    return { type: 'error' as const, title: '试用期已结束（只读模式）', text: '业务单据已暂停新增与修改，查看、导出与备份不受影响。请购买激活恢复全部功能。', cta: '立即激活' as const }
  }
  if (s.phase === 'extended' && daysLeft <= 7) {
    return { type: 'warning' as const, title: `延期试用剩余 ${daysLeft} 天`, text: '延期结束后将进入只读模式，请及时购买激活。', cta: '立即激活' as const }
  }
  if (elapsed < 2) {
    return { type: 'info' as const, title: '欢迎体验禾序进销存（7 天全功能试用）', text: '已为您准备好演示数据：试着一开销售单，看看库存和流水如何自动联动。', cta: '完成第一笔销售' as const }
  }
  if (elapsed < 4) {
    return { type: 'info' as const, title: '小技巧：让数据为你打工', text: '库存预警帮你盯紧断货风险，销售统计帮你看清哪款最好卖。', cta: '查看库存预警' as const }
  }
  return { type: 'warning' as const, title: `试用剩余 ${daysLeft} 天`, text: '可免费延长 7 天（仅一次），或直接购买激活。', cta: '延期 / 激活' as const }
})

async function loadTrialStatus(): Promise<void> {
  try {
    licenseStatus.value = await licenseApi.check()
  } catch {
    licenseStatus.value = null
  }
}

function onTrialCta(): void {
  const s = licenseStatus.value
  if (!s) return
  if (s.phase === 'expired' || (s.phase === 'extended' && (s.daysLeft ?? 0) <= 7)) {
    void $router.push('/activate')
    return
  }
  const elapsed = 14 - (s.daysLeft ?? 0)
  if (elapsed < 2) {
    void $router.push('/sale/edit')
  } else if (elapsed < 4) {
    void $router.push('/inventory/warning')
  } else {
    void onExtendTrial()
  }
}

async function onExtendTrial(): Promise<void> {
  extendingTrial.value = true
  try {
    licenseStatus.value = await licenseApi.extendTrial()
    ElMessage.success('已延长试用 7 天，全部功能继续可用')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    extendingTrial.value = false
  }
}

function dismissTrialBanner(): void {
  licenseStatus.value = null
  try {
    localStorage.setItem(TRIAL_BANNER_DISMISS_KEY, '1')
  } catch {
    /* 忽略 */
  }
}

const summary = ref<DashboardSummary | null>(null)
const trend = ref<DashboardTrendRow[]>([])
const loading = ref(false)
const errMsg = ref('')
// [5] 日报速览（S 级功能批次 B）
const brief = ref<TodayBrief | null>(null)
// [6] 待办提醒（S 级功能批次 B）
const reminders = ref<ReminderItem[]>([])

const fmtMoney = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const cards: { label: string; key: keyof DashboardSummary; accent: string }[] = [
  { label: '今日销售额', key: 'sales_amount', accent: 'card-blue' },
  { label: '今日毛利', key: 'gross_profit', accent: 'card-green' },
  { label: '今日零售', key: 'retail_amount', accent: 'card-blue' },
  { label: '今日收款', key: 'receipt_amount', accent: 'card-green' },
  { label: '库存金额', key: 'stock_amount', accent: 'card-orange' },
  { label: '应收合计', key: 'total_receivable', accent: 'card-orange' },
  { label: '应付合计', key: 'total_payable', accent: 'card-red' }
]

async function load(): Promise<void> {
  loading.value = true
  errMsg.value = ''
  try {
    const [s, t, b, rs] = await Promise.all([
      dashboardApi.summary(),
      dashboardApi.trend(7),
      // [5] 日报速览
      dashboardApi.todayBrief(),
      // [6] 待办提醒
      dashboardApi.reminders()
    ])
    summary.value = s
    trend.value = t
    brief.value = b
    reminders.value = rs
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function barHeight(amount: number): string {
  const max = Math.max(...trend.value.map((r) => r.amount), 1)
  return `${Math.max(2, Math.round((amount / max) * 100))}%`
}

function barTitle(r: DashboardTrendRow): string {
  return `${r.date}：${fmtMoney(r.amount)} 元`
}

// [6] 提醒类型 → 文案与跳转路由
const reminderMeta: Record<ReminderItem['type'], { label: string; route: string }> = {
  stock_warn: { label: '库存预警', route: '/inventory/warning' },
  arrears: { label: '往来欠款', route: '/stats/arrears' },
  expiring: { label: '批次临期', route: '/product/batches' }
}

function goReminder(type: ReminderItem['type']): void {
  void $router.push(reminderMeta[type].route)
}

onMounted(() => {
  void loadTrialStatus()
  load()
})
</script>

<template>
  <div class="dashboard" v-loading="loading">
    <header class="dashboard-heading"><div><div class="brand-eyebrow">BUSINESS OVERVIEW</div><h1>经营概况</h1><p>从每一笔记录，看清今天的生意。</p></div><el-button :loading="loading" @click="load">刷新数据</el-button></header>
    <el-alert v-if="errMsg" type="error" :title="errMsg" show-icon :closable="false" />
    <!-- 试用引导条：第 1 天 onboarding / 第 3 天价值提示 / 第 5 天剩余提醒+延期 / expired 只读提示 -->
    <el-alert
      v-if="trialBanner"
      :type="trialBanner.type"
      :title="trialBanner.title"
      show-icon
      :closable="trialBanner.type !== 'error'"
      @close="dismissTrialBanner"
    >
      <span>{{ trialBanner.text }}</span>
      <el-button size="small" type="primary" link :loading="extendingTrial" @click="onTrialCta">{{ trialBanner.cta }}</el-button>
    </el-alert>
    <template v-if="summary">
      <div class="card-row">
        <template v-for="c in cards" :key="c.label">
          <div v-if="summary[c.key] !== null" class="stat-card" :class="c.accent">
            <div class="stat-label">{{ c.label }}</div>
            <div class="stat-value">{{ fmtMoney(summary[c.key] ?? 0) }}</div>
          </div>
        </template>
      </div>

      <!-- [5] 今日速览四格卡片（S 级功能批次 B） -->
      <div v-if="brief" class="card-row brief-row">
        <div class="stat-card card-blue">
          <div class="stat-label">昨日库存量</div>
          <div class="stat-value">{{ brief.yesterday_stock_qty }}</div>
        </div>
        <div class="stat-card card-green">
          <div class="stat-label">今日销售量</div>
          <div class="stat-value">{{ brief.today_sale_qty }}</div>
        </div>
        <div class="stat-card card-orange">
          <div class="stat-label">今日入库量</div>
          <div class="stat-value">{{ brief.today_in_qty }}</div>
        </div>
        <div class="stat-card card-red">
          <div class="stat-label">当前库存量</div>
          <div class="stat-value">{{ brief.today_stock_qty }}</div>
        </div>
      </div>

      <!-- [6] 待办提醒卡片（S 级功能批次 B） -->
      <el-card v-if="reminders.length > 0" class="section reminder-card" shadow="never">
        <template #header>待办提醒</template>
        <div class="reminder-row">
          <div
            v-for="r in reminders"
            :key="r.type"
            class="reminder-item"
            :class="{ 'reminder-none': r.count === 0 }"
            @click="goReminder(r.type)"
          >
            <div class="reminder-label">{{ reminderMeta[r.type].label }}</div>
            <div class="reminder-count">{{ r.count }}</div>
            <div class="reminder-go">点击处理 →</div>
          </div>
        </div>
      </el-card>

      <el-card class="section" shadow="never">
        <template #header>近7天销售趋势（销售 + 零售）</template>
        <div class="trend-chart">
          <div v-for="r in trend" :key="r.date" class="trend-col">
            <div class="trend-bar-wrap">
              <div class="trend-bar" :style="{ height: barHeight(r.amount) }" :title="barTitle(r)"></div>
            </div>
            <div class="trend-date">{{ r.date.slice(5) }}</div>
          </div>
        </div>
        <div v-if="trend.every((r) => r.amount === 0)" class="trend-empty">近7天暂无销售数据</div>
      </el-card>

      <el-card class="section" shadow="never">
        <template #header>今日单据</template>
        <div class="doc-nums">
          <span>销售单 <b>{{ summary.sales_count }}</b> 张</span>
          <span>库存预警 <b>{{ summary.low_stock_count }}</b> 种</span>
        </div>
        <div
          v-if="summary.expiring_batch_count > 0 || summary.expired_batch_count > 0"
          class="shelf-alert"
          @click="$router.push('/product/batches')"
        >
          <el-alert type="warning" :closable="false">
            <template #title>
              批次效期提醒：临期 {{ summary.expiring_batch_count }} 批、已过期 {{ summary.expired_batch_count }} 批，点击查看批次效期 →
            </template>
          </el-alert>
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 24px;
}
.shelf-alert {
  margin-top: 8px;
  cursor: pointer;
}
.card-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  flex: 1 1 120px;
  min-width: 120px;
  border-radius: 8px;
  padding: 14px 16px;
  color: #fff;
}
.card-blue {
  background: #12685E;
}
.card-green {
  background: #236E62;
}
.card-orange {
  background: #78603B;
}
.card-red {
  background: #99534B;
}
.stat-label {
  font-size: 13px;
  opacity: 0.9;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  margin-top: 6px;
}
.section {
  margin-bottom: 16px;
}
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 180px;
  padding-top: 8px;
}
.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.trend-bar-wrap {
  flex: 1;
  width: 60%;
  max-width: 48px;
  display: flex;
  align-items: flex-end;
}
.trend-bar {
  width: 100%;
  min-height: 2px;
  background: #12685E;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s;
}
.trend-date {
  margin-top: 6px;
  font-size: 12px;
  color: #888;
}
.trend-empty {
  text-align: center;
  color: #999;
  font-size: 13px;
  margin-top: 8px;
}
.doc-nums {
  font-size: 14px;
  color: #555;
}
.doc-nums b {
  color: #12685E;
  font-size: 18px;
}
/* [5] 今日速览：四格等分 */
.brief-row .stat-card {
  flex: 1 1 0;
  text-align: center;
}
/* [6] 待办提醒 */
.reminder-row {
  display: flex;
  gap: 12px;
}
.reminder-item {
  flex: 1;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.reminder-item:hover {
  border-color: #12685E;
  box-shadow: 0 2px 8px rgba(18, 104, 94, 0.15);
}
.reminder-none {
  opacity: 0.55;
}
.reminder-label {
  font-size: 13px;
  color: #666;
}
.reminder-count {
  font-size: 24px;
  font-weight: 700;
  color: #12685E;
  margin: 4px 0;
}
.reminder-go {
  font-size: 12px;
  color: #999;
}
</style>
