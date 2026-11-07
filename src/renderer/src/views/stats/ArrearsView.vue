<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { arrearsApi } from '../../api/stats'
import type { ArrearsRow, ArrearsSummary } from '../../api/stats'

const router = useRouter()

const loading = ref(false)
const receivables = ref<ArrearsRow[]>([])
const payables = ref<ArrearsRow[]>([])
const summary = ref<ArrearsSummary>({ total_receivable: 0, total_payable: 0 })

async function load(): Promise<void> {
  loading.value = true
  try {
    const [rec, pay, sum] = await Promise.all([
      arrearsApi.receivables(),
      arrearsApi.payables(),
      arrearsApi.summary()
    ])
    receivables.value = rec
    payables.value = pay
    summary.value = sum
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

// P1-4：未分配款项补核销入口——从应收/应付行直接跳到收/付款单，
// 携带 partner 预填（PaymentEditView 的 route.query.partner watcher 会
// 自动加载该往来单位全部待核销单据，含历史旧单）。
function goSettle(row: ArrearsRow, kind: 'receipt' | 'payment'): void {
  void router.push({ path: kind === 'receipt' ? '/payment/receipt' : '/payment/payment', query: { partner: row.partner_id } })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="arrears-view">
    <div class="summary-cards">
      <el-card shadow="never" class="summary-card receivable">
        <div class="card-label">应收合计（元）</div>
        <div class="card-value">{{ fmt(summary.total_receivable) }}</div>
      </el-card>
      <el-card shadow="never" class="summary-card payable">
        <div class="card-label">应付合计（元）</div>
        <div class="card-value">{{ fmt(summary.total_payable) }}</div>
      </el-card>
      <div class="toolbar">
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <el-card shadow="never" class="section">
      <template #header>
        <span class="section-title">应收账款（客户）</span>
      </template>
      <el-table :data="receivables" v-loading="loading" stripe>
        <el-table-column prop="partner_name" label="客户" min-width="140" />
        <el-table-column label="期初应收" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.opening) }}</template>
        </el-table-column>
        <el-table-column label="销售额" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="已收" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.settled) }}</template>
        </el-table-column>
        <el-table-column label="应收余额" align="right" width="130">
          <template #default="{ row }">
            <span class="balance" :class="{ zero: row.balance === 0 }">{{ fmt(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.balance <= 0" @click="goSettle(row, 'receipt')">去收款</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="section">
      <template #header>
        <span class="section-title">应付账款（供应商）</span>
      </template>
      <el-table :data="payables" v-loading="loading" stripe>
        <el-table-column prop="partner_name" label="供应商" min-width="140" />
        <el-table-column label="期初应付" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.opening) }}</template>
        </el-table-column>
        <el-table-column label="采购额" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="已付" align="right" width="120">
          <template #default="{ row }">{{ fmt(row.settled) }}</template>
        </el-table-column>
        <el-table-column label="应付余额" align="right" width="130">
          <template #default="{ row }">
            <span class="balance" :class="{ zero: row.balance === 0 }">{{ fmt(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.balance <= 0" @click="goSettle(row, 'payment')">去付款</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.arrears-view {
  padding: 16px;
}

.summary-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  align-items: stretch;
}

.summary-card {
  flex: 0 0 240px;
}

.card-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.card-value {
  font-size: 24px;
  font-weight: 600;
  margin-top: 4px;
}

.summary-card.receivable .card-value {
  color: var(--el-color-danger);
}

.summary-card.payable .card-value {
  color: var(--el-color-warning);
}

.toolbar {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.section {
  margin-bottom: 16px;
}

.section-title {
  font-weight: 600;
}

.balance {
  font-weight: 600;
  color: var(--el-color-danger);
}

.balance.zero {
  color: var(--el-text-color-secondary);
  font-weight: normal;
}
</style>
