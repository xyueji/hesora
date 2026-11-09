<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { monthlyStockApi, type MonthlyStockRow } from '../../api/stats'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import type { Product } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'
import { hasPermission } from '../../stores/auth'

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 5 + i).reverse()
const year = ref(currentYear)
const warehouseId = ref<number | null>(null)
const productId = ref<number | null>(null)
const warehouses = ref<Warehouse[]>([])
const products = ref<Product[]>([])
const rows = ref<MonthlyStockRow[]>([])
const loading = ref(false)
let request = 0

const canView = hasPermission('report.business')

async function load(): Promise<void> {
  if (!canView) return
  const current = ++request
  loading.value = true
  try {
    const result = await monthlyStockApi.query({
      year: year.value,
      warehouse_id: warehouseId.value ?? undefined,
      product_id: productId.value ?? undefined
    })
    if (current === request) rows.value = result
  } catch (e) {
    if (current === request) ElMessage.error((e as Error).message)
  } finally {
    if (current === request) loading.value = false
  }
}

const productRemoteLoading = ref(false)
async function searchProducts(keyword: string): Promise<void> {
  productRemoteLoading.value = true
  try {
    const r = await productApi.query({ keyword, page: 1, pageSize: 20 })
    products.value = r.list
  } catch {
    /* 搜索失败保持现有选项 */
  } finally {
    productRemoteLoading.value = false
  }
}

function money(value: number): string {
  return value.toFixed(2)
}

function qty(value: number): string {
  return String(Number(value.toFixed(4)))
}

function rowClass({ row }: { row: MonthlyStockRow }): string {
  return row.month === 0 ? 'total-row' : ''
}

function monthLabel(month: number): string {
  return month === 0 ? '全年合计' : `${month}月`
}

onMounted(() => {
  void warehouseApi.query({ page: 1, pageSize: 100 }).then((r) => {
    warehouses.value = r.list
  }).catch(() => undefined)
  void searchProducts('')
  void load()
})
</script>

<template>
  <el-card shadow="never">
    <template #header><strong>月度库存汇总</strong></template>
    <div class="filters">
      <el-select v-model="year" style="width: 120px" @change="load">
        <el-option v-for="y in yearOptions" :key="y" :label="`${y} 年`" :value="y" />
      </el-select>
      <el-select v-model="warehouseId" clearable placeholder="全部仓库" style="width: 160px" @change="load">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-select
        v-model="productId"
        clearable
        filterable
        remote
        :remote-method="searchProducts"
        :loading="productRemoteLoading"
        placeholder="全部商品"
        style="width: 220px"
        @change="load"
      >
        <el-option v-for="p in products" :key="p.id" :label="`${p.code} ${p.name}`" :value="p.id" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" stripe :row-class-name="rowClass" size="small">
      <el-table-column label="月份" width="90">
        <template #default="{ row }">{{ monthLabel(row.month) }}</template>
      </el-table-column>
      <el-table-column label="期初数量" align="right" min-width="100">
        <template #default="{ row }">{{ qty(row.opening_qty) }}</template>
      </el-table-column>
      <el-table-column label="期初金额" align="right" min-width="110">
        <template #default="{ row }">{{ money(row.opening_amount) }}</template>
      </el-table-column>
      <el-table-column label="入库数量" align="right" min-width="100">
        <template #default="{ row }">{{ qty(row.in_qty) }}</template>
      </el-table-column>
      <el-table-column label="入库金额" align="right" min-width="110">
        <template #default="{ row }">{{ money(row.in_amount) }}</template>
      </el-table-column>
      <el-table-column label="出库数量" align="right" min-width="100">
        <template #default="{ row }">{{ qty(row.out_qty) }}</template>
      </el-table-column>
      <el-table-column label="出库金额" align="right" min-width="110">
        <template #default="{ row }">{{ money(row.out_amount) }}</template>
      </el-table-column>
      <el-table-column label="期末数量" align="right" min-width="100">
        <template #default="{ row }">{{ qty(row.ending_qty) }}</template>
      </el-table-column>
      <el-table-column label="期末金额" align="right" min-width="110">
        <template #default="{ row }">{{ money(row.ending_amount) }}</template>
      </el-table-column>
      <template #empty>暂无数据，请调整条件后查询</template>
    </el-table>
    <p class="tip">口径：基于成本变动记录（cost_log）；期初金额 ≈ 累计入库金额 − 累计出库金额，与成本变动明细一致；无变动月份数值承前。</p>
  </el-card>
</template>

<style scoped>
.monthly-stock .filters,
.filters {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.total-row :deep(td) {
  font-weight: 600;
  background: var(--el-fill-color-light);
}
.tip {
  margin: 10px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
