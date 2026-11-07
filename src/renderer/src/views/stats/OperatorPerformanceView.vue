<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { operatorPerformanceApi, type OperatorPerformanceRow } from '../../api/stats'

const dates = ref<[string, string] | null>(null)
const keyword = ref('')
const rows = ref<OperatorPerformanceRow[]>([])
const loading = ref(false)
let request = 0

async function load(): Promise<void> {
  const current = ++request
  loading.value = true
  try {
    const result = await operatorPerformanceApi.query({
      date_from: dates.value?.[0],
      date_to: dates.value?.[1],
      operator: keyword.value || undefined
    })
    if (current === request) rows.value = result
  } catch (e) {
    if (current === request) ElMessage.error((e as Error).message)
  } finally {
    if (current === request) loading.value = false
  }
}

function money(value: number): string {
  return value.toFixed(2)
}

onMounted(() => void load())
</script>

<template>
  <el-card shadow="never">
    <template #header><strong>员工业绩</strong></template>
    <div class="op-filters">
      <el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始日期" end-placeholder="结束日期" @change="load" />
      <el-input v-model="keyword" placeholder="业务员（姓名/编号关键字）" clearable style="width: 220px"
        @keyup.enter="load" @clear="load" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column label="业务员" min-width="140">
        <template #default="{ row }">{{ row.operator || '（无业务员）' }}</template>
      </el-table-column>
      <el-table-column label="销售额" align="right" min-width="120">
        <template #default="{ row }">{{ money(row.sales_amount) }}</template>
      </el-table-column>
      <el-table-column label="退货额" align="right" min-width="120">
        <template #default="{ row }">{{ money(row.return_amount) }}</template>
      </el-table-column>
      <el-table-column label="单数" align="right" min-width="90" prop="doc_count" />
      <el-table-column label="毛利（近似）" align="right" min-width="130">
        <template #default="{ row }">{{ money(row.gross_profit) }}</template>
      </el-table-column>
      <template #empty>暂无数据，请调整条件后查询</template>
    </el-table>
  </el-card>
</template>

<style scoped>
.op-filters {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
</style>
