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
    <el-alert v-if="errMsg" type="error" :title="errMsg" show-icon :closable="false" />
    <template v-if="summary">
      <div class="card-row">
        <div v-for="c in cards" :key="c.label" class="stat-card" :class="c.accent">
          <div class="stat-label">{{ c.label }}</div>
          <div class="stat-value">{{ fmtMoney(summary[c.key]) }}</div>
        </div>
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
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 24px;
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
  background: linear-gradient(135deg, #3a7bd5, #2b5fa8);
}
.card-green {
  background: linear-gradient(135deg, #2f9e6e, #1f7a50);
}
.card-orange {
  background: linear-gradient(135deg, #e08e2b, #c06f10);
}
.card-red {
  background: linear-gradient(135deg, #d95a4e, #b03a30);
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
  background: #3a7bd5;
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
  color: #2b5fa8;
  font-size: 18px;
}
</style>
