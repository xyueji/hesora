<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { arrearsApi } from '../../api/stats'
import { csvApi } from '../../api/csv'
import type { AgingResult, AgingRow } from '../../api/stats'

// P2-2 账龄报表：客户/供应商未结余额按单据日期分档（0-30/31-60/61-90/90+），
// 核销按 FIFO 归属最早单据，期初余额记 90+ 档。用于催款与坏账风险判断。
const loading = ref(false)
const result = ref<AgingResult | null>(null)
const asOf = ref(new Date().toISOString().slice(0, 10))

const activeTab = ref<'customers' | 'suppliers'>('customers')
const rows = computed<AgingRow[]>(() => result.value?.[activeTab.value] ?? [])

function fmt(n: number): string {
  return n.toFixed(2)
}

function bucketClass(v: number): string {
  return v > 0 ? 'aged' : ''
}

async function load(): Promise<void> {
  loading.value = true
  try {
    result.value = await arrearsApi.aging(asOf.value)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

const exporting = ref(false)
async function exportCsv(): Promise<void> {
  exporting.value = true
  try {
    const file = await csvApi.export('aging', { agingSide: activeTab.value, asOf: asOf.value })
    ElMessage.success(`已导出：${file}`)
  } catch (e) {
    const msg = (e as Error).message
    if (!msg.includes('取消')) ElMessage.error(msg)
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="aging-view">
    <div class="toolbar">
      <span class="label">截至日期</span>
      <el-date-picker v-model="asOf" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 150px" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <el-button :loading="exporting" @click="exportCsv">导出 CSV</el-button>
    </div>

    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="客户应收账龄" name="customers" />
        <el-tab-pane label="供应商应付账龄" name="suppliers" />
      </el-tabs>
      <el-table :data="rows" v-loading="loading" stripe show-summary :summary-method="() => []">
        <el-table-column prop="partner_name" label="往来单位" min-width="140" />
        <el-table-column label="未结合计" align="right" width="120">
          <template #default="{ row }">
            <span class="balance">{{ fmt(row.total) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="0-30 天" align="right" width="110">
          <template #default="{ row }"><span :class="bucketClass(row.b0_30)">{{ fmt(row.b0_30) }}</span></template>
        </el-table-column>
        <el-table-column label="31-60 天" align="right" width="110">
          <template #default="{ row }"><span :class="bucketClass(row.b31_60)">{{ fmt(row.b31_60) }}</span></template>
        </el-table-column>
        <el-table-column label="61-90 天" align="right" width="110">
          <template #default="{ row }"><span :class="bucketClass(row.b61_90)">{{ fmt(row.b61_90) }}</span></template>
        </el-table-column>
        <el-table-column label="90 天以上" align="right" width="120">
          <template #default="{ row }"><span :class="bucketClass(row.b90plus)">{{ fmt(row.b90plus) }}</span></template>
        </el-table-column>
        <el-table-column label="最早单据" width="120">
          <template #default="{ row }">{{ row.oldest || '—' }}</template>
        </el-table-column>
      </el-table>
      <p class="hint">核销按先进先出归属到最早的单据；期初应收/应付计入"90 天以上"档。账龄随日期推自动增长。</p>
    </el-card>
  </div>
</template>

<style scoped>
.aging-view {
  padding: 16px;
  max-width: 1000px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.balance {
  font-weight: 600;
  color: var(--el-color-danger);
}
.aged {
  color: var(--el-color-warning);
  font-weight: 600;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 8px 0 0;
}
</style>
