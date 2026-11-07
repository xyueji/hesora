<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { stockReportApi } from '../../api/stock-report'
import { warehouseApi } from '../../api/warehouse'
import { COST_SOURCE_OPTIONS } from '../../../../shared/types/stock-report'
import type { CostChangeRow } from '../../../../shared/types/stock-report'

const keyword = ref('')
const warehouseId = ref<number | undefined>(undefined)
const source = ref<string | undefined>(undefined)
const dateRange = ref<string[] | null>(null)
const loading = ref(false)
const items = ref<CostChangeRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const warehouses = ref<{ id: number; name: string }[]>([])
const sumQty = ref(0)
const sumAmount = ref(0)
const sumCount = ref(0)

const sourceOptions = computed(() => COST_SOURCE_OPTIONS)

function fmt(n: number): string {
  return n.toFixed(2)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await stockReportApi.costChanges({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value,
      source: source.value,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    })
    items.value = r.items
    total.value = r.total
    sumQty.value = r.totals.change_qty
    sumAmount.value = r.totals.change_amount
    sumCount.value = r.totals.count
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  warehouseId.value = undefined
  source.value = undefined
  dateRange.value = null
  page.value = 1
  void load()
}

function summaryMethod(): string[] {
  return [
    '',
    '',
    `合计（${sumCount.value} 笔）`,
    '',
    '',
    '',
    '',
    '',
    fmt(sumQty.value),
    '',
    fmt(sumAmount.value),
    '',
    '',
    ''
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
  <div class="cost-change">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">成本变动明细</h3>
        <div class="filters">
          <el-input
            v-model="keyword"
            placeholder="商品编码 / 名称 / 单据号"
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
          <el-select v-model="source" placeholder="全部来源" clearable class="src-select" @change="search">
            <el-option v-for="s in sourceOptions" :key="s.value" :label="s.label" :value="s.value" />
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

      <el-table
        :data="items"
        v-loading="loading"
        border
        show-summary
        :summary-method="summaryMethod"
        empty-text="暂无成本变动记录"
      >
        <el-table-column prop="created_at" label="变动时间" width="150" />
        <el-table-column prop="code" label="商品编码" min-width="100" />
        <el-table-column prop="name" label="商品名称" min-width="130" />
        <el-table-column prop="spec" label="规格" min-width="100" />
        <el-table-column prop="warehouse_name" label="仓库" min-width="90" />
        <el-table-column prop="batch_no" label="批次" min-width="90">
          <template #default="{ row }">{{ row.batch_no || '—' }}</template>
        </el-table-column>
        <el-table-column prop="source_label" label="来源" width="100" />
        <el-table-column prop="source_no" label="单据号" width="140">
          <template #default="{ row }">{{ row.source_no || '—' }}</template>
        </el-table-column>
        <el-table-column prop="change_qty" label="变动数量" align="right" width="100" />
        <el-table-column prop="unit_cost" label="单价" align="right" width="100">
          <template #default="{ row }">{{ fmt(row.unit_cost) }}</template>
        </el-table-column>
        <el-table-column prop="change_amount" label="变动金额" align="right" width="110">
          <template #default="{ row }">{{ fmt(row.change_amount) }}</template>
        </el-table-column>
        <el-table-column prop="before_qty" label="变动前结存" align="right" width="110" />
        <el-table-column prop="after_qty" label="变动后结存" align="right" width="110" />
        <el-table-column prop="after_cost" label="变动后成本单价" align="right" width="130">
          <template #default="{ row }">{{ fmt(row.after_cost) }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, sizes"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="load"
          @size-change="search"
        />
      </div>
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
.src-select {
  width: 130px;
}
.date-range {
  width: 260px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
