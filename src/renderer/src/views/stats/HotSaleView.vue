<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { hotSaleApi, type HotSaleRow } from '../../api/stats'
import { warehouseApi } from '../../api/warehouse'
import type { Warehouse } from '../../../../shared/types/warehouse'

const dates = ref<[string, string] | null>(null)
const top = ref(20)
const warehouse = ref<number | undefined>()
const warehouses = ref<Warehouse[]>([])
const rows = ref<HotSaleRow[]>([])
const loading = ref(false)
let request = 0

async function load(): Promise<void> {
  const current = ++request
  if (!dates.value?.[0] || !dates.value?.[1]) {
    ElMessage.warning('请选择有效的日期范围')
    return
  }
  loading.value = true
  try {
    const result = await hotSaleApi.query({
      date_from: dates.value[0],
      date_to: dates.value[1],
      top: top.value,
      warehouse_id: warehouse.value || undefined
    })
    if (current === request) rows.value = result
  } catch (e) {
    if (current === request) ElMessage.error((e as Error).message)
  } finally {
    if (current === request) loading.value = false
  }
}

function refresh(): void {
  void load()
}

onMounted(async () => {
  try {
    const wh = await warehouseApi.query({ page: 1, pageSize: 200 })
    warehouses.value = wh.list
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
})
</script>

<template>
  <el-card shadow="never">
    <template #header><strong>热销榜</strong></template>
    <div class="hotsale-filters">
      <el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始日期" end-placeholder="结束日期" @change="refresh" />
      <el-input-number v-model="top" :min="1" :max="200" :step="5" aria-label="显示条数" @change="refresh" />
      <el-select v-model="warehouse" clearable placeholder="全部仓库" style="width: 140px" @change="refresh">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id!" />
      </el-select>
      <el-button type="primary" @click="refresh">查询</el-button>
    </div>
    <p class="note">按销售单与零售单已入账数量排序（正向口径，销售退货不冲减）。前 {{ top }} 名。</p>
    <el-table v-loading="loading" :data="rows" empty-text="所选日期内暂无销售记录" stripe>
      <el-table-column type="index" label="排名" width="70" />
      <el-table-column prop="code" label="商品编码" min-width="120" show-overflow-tooltip />
      <el-table-column prop="name" label="商品名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="sale_qty" label="销售数量" width="110" align="right" />
      <el-table-column label="销售金额" width="130" align="right">
        <template #default="{ row }">{{ row.sale_amount.toFixed(2) }}</template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.hotsale-filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.note { color: var(--el-text-color-secondary); }
</style>
