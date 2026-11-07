<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { stockReportApi } from '../../api/stock-report'
import { warehouseApi } from '../../api/warehouse'
import type { StockFlowRow } from '../../../../shared/types/stock-report'

const keyword = ref('')
const warehouseId = ref<number | undefined>(undefined)
const dateRange = ref<string[] | null>(null)
const loading = ref(false)
const items = ref<StockFlowRow[]>([])
const warehouses = ref<{ id: number; name: string }[]>([])
const totals = ref({
  open_qty: 0,
  in_qty: 0,
  out_qty: 0,
  close_qty: 0,
  open_amount: 0,
  in_amount: 0,
  out_amount: 0,
  close_amount: 0
})

const hasRange = computed(() => !!dateRange.value && dateRange.value.length === 2)

function fmt(n: number): string {
  return n.toFixed(2)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await stockReportApi.stockFlow({
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    })
    items.value = r.items
    totals.value = r.totals
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function search(): void {
  void load()
}

function reset(): void {
  keyword.value = ''
  warehouseId.value = undefined
  dateRange.value = null
  void load()
}

function summaryMethod(): string[] {
  const t = totals.value
  return [
    '',
    '合计',
    '',
    '',
    '',
    fmt(t.open_qty),
    fmt(t.in_qty),
    fmt(t.out_qty),
    fmt(t.close_qty),
    fmt(t.open_amount),
    fmt(t.in_amount),
    fmt(t.out_amount),
    fmt(t.close_amount)
  ]
}

onMounted(async () => {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouses.value = r.list.flatMap((w) =>
      typeof w.id === 'number' ? [{ id: w.id, name: w.name }] : []
    )
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
  await load()
})
</script>

<template>
  <div class="stock-flow">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">库存流水（收发存）</h3>
        <div class="filters">
          <el-input
            v-model="keyword"
            placeholder="商品编码 / 名称"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-select
            v-model="warehouseId"
            placeholder="全部仓库"
            clearable
            class="wh-select"
            @change="search"
          >
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            class="date-range"
            @change="search"
          />
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>

      <el-alert
        v-if="!hasRange"
        type="info"
        show-icon
        :closable="false"
        class="tip"
        title="未选择日期区间时，期初数量按 0 计算；选择开始日期后，期初结存取该日期之前的库存结存。"
      />

      <el-table
        :data="items"
        v-loading="loading"
        border
        show-summary
        :summary-method="summaryMethod"
        empty-text="暂无库存流水"
      >
        <el-table-column prop="code" label="商品编码" min-width="110" />
        <el-table-column prop="name" label="商品名称" min-width="140" />
        <el-table-column prop="spec" label="规格" min-width="100" />
        <el-table-column prop="base_unit" label="单位" width="70" />
        <el-table-column prop="warehouse_name" label="仓库" min-width="100" />
        <el-table-column prop="open_qty" label="期初数量" align="right" width="100" />
        <el-table-column prop="in_qty" label="入库数量" align="right" width="100" />
        <el-table-column prop="out_qty" label="出库数量" align="right" width="100" />
        <el-table-column prop="close_qty" label="结存数量" align="right" width="100" />
        <el-table-column prop="open_amount" label="期初金额" align="right" width="110">
          <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
        </el-table-column>
        <el-table-column prop="in_amount" label="入库金额" align="right" width="110">
          <template #default="{ row }">{{ fmt(row.in_amount) }}</template>
        </el-table-column>
        <el-table-column prop="out_amount" label="出库金额" align="right" width="110">
          <template #default="{ row }">{{ fmt(row.out_amount) }}</template>
        </el-table-column>
        <el-table-column prop="close_amount" label="结存金额" align="right" width="110">
          <template #default="{ row }">{{ fmt(row.close_amount) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}
.title {
  margin: 0;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.search {
  width: 200px;
}
.wh-select {
  width: 140px;
}
.date-range {
  width: 260px;
}
.tip {
  margin-bottom: 10px;
}
</style>
