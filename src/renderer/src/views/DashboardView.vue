<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { dashboardApi, type DashboardSummary, type DashboardTrendRow } from '../api/dashboard'

const summary = ref<DashboardSummary | null>(null)
const trend = ref<DashboardTrendRow[]>([])
const loading = ref(false)
const errMsg = ref('')

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
    const [s, t] = await Promise.all([dashboardApi.summary(), dashboardApi.trend(7)])
    summary.value = s
    trend.value = t
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

onMounted(load)
</script>

<template>
  <div class="dashboard" v-loading="loading">
    <header class="dashboard-heading"><div><div class="brand-eyebrow">BUSINESS OVERVIEW</div><h1>经营概况</h1><p>从每一笔记录，看清今天的生意。</p></div><el-button :loading="loading" @click="load">刷新数据</el-button></header>
    <el-alert v-if="errMsg" type="error" :title="errMsg" show-icon :closable="false" />
    <template v-if="summary">
      <div class="card-row">
        <template v-for="c in cards" :key="c.label">
          <div v-if="summary[c.key] !== null" class="stat-card" :class="c.accent">
            <div class="stat-label">{{ c.label }}</div>
            <div class="stat-value">{{ fmtMoney(summary[c.key] ?? 0) }}</div>
          </div>
        </template>
      </div>

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
</style>
