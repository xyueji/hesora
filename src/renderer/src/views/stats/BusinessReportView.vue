<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { reportApi } from '../../api/stats'
import { csvApi } from '../../api/csv'
import { warehouseApi } from '../../api/warehouse'
import { fundApi } from '../../api/fund'
import { hasPermission } from '../../stores/auth'
import { REPORT_COLUMNS, REPORT_LABELS, type ReportColumn, type ReportKind, type ReportQuery, type ReportRow } from '../../../../shared/types/report'
import { DOC_TYPE_LABELS, type DocType } from '../../../../shared/types/doc'
import type { FundAccount } from '../../../../shared/types/fund'
import type { Warehouse } from '../../../../shared/types/warehouse'

const kind = ref<ReportKind>('sales')
const dates = ref<[string, string] | null>(null)
const warehouse = ref<number | undefined>()
const account = ref<number | undefined>()
const direction = ref<'in' | 'out' | undefined>()
const keyword = ref('')
const warehouses = ref<Warehouse[]>([])
const accounts = ref<FundAccount[]>([])
const totals = ref<{ income: number; expense: number }>()
const page = ref(1)
const pageSize = 30
const total = ref(0)
const rows = ref<ReportRow[]>([])
const loading = ref(false)
const exporting = ref(false)
let request = 0

function filters(): ReportQuery {
  return {
    kind: kind.value,
    date_from: dates.value?.[0],
    date_to: dates.value?.[1],
    warehouse_id: warehouse.value || undefined,
    account_id: account.value || undefined,
    direction: direction.value || undefined,
    keyword: keyword.value
  }
}

async function exportReport(): Promise<void> {
  exporting.value = true
  try {
    const path = await csvApi.export('report', { report: filters() })
    ElMessage.success(`已导出到 ${path}`)
  } catch (e) {
    const message = (e as Error).message
    if (message !== '已取消导出') ElMessage.error(message)
  } finally {
    exporting.value = false
  }
}

async function load(): Promise<void> {
  const current = ++request
  loading.value = true
  try {
    const result = await reportApi.query({ ...filters(), page: page.value, pageSize })
    if (current === request) {
      rows.value = result.rows
      total.value = result.total
      totals.value = result.totals
    }
  } catch (e) {
    if (current === request) ElMessage.error((e as Error).message)
  } finally {
    if (current === request) loading.value = false
  }
}

function refresh(): void {
  page.value = 1
  rows.value = []
  total.value = 0
  totals.value = undefined
  void load()
}

function changeReport(): void {
  keyword.value = ''
  refresh()
}

function display(row: ReportRow, column: ReportColumn): string | number {
  const [key, , money] = column
  const value = row[key]
  if (key === 'type' && typeof value === 'string') return value === 'account_transfer' ? '账户转账' : DOC_TYPE_LABELS[value as DocType] ?? value
  if (money && typeof value === 'number') return value.toFixed(2)
  return value ?? '—'
}

onMounted(async () => {
  void load()
  try {
    const [wh, fund] = await Promise.all([warehouseApi.query({ page: 1, pageSize: 200 }), fundApi.query({ page: 1, pageSize: 200 })])
    warehouses.value = wh.list
    accounts.value = fund.list
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
})
</script>

<template>
  <el-card shadow="never">
    <template #header><strong>经营报表</strong></template>
    <div class="report-filters">
      <el-select v-model="kind" aria-label="报表类型" style="width: 160px" @change="changeReport">
        <el-option v-for="(label, value) in REPORT_LABELS" :key="value" :label="label" :value="value" />
      </el-select>
      <el-date-picker v-if="kind !== 'stockSheet'" v-model="dates" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始日期" end-placeholder="结束日期" @change="refresh" />
      <el-select v-if="kind !== 'fund'" v-model="warehouse" clearable placeholder="全部仓库" style="width: 140px" @change="refresh">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id!" />
      </el-select>
      <template v-else>
        <el-select v-model="account" clearable placeholder="全部账户" style="width: 140px" @change="refresh">
          <el-option v-for="a in accounts" :key="a.id" :label="a.name" :value="a.id!" />
        </el-select>
        <el-select v-model="direction" clearable placeholder="收入及支出" style="width: 120px" @change="refresh">
          <el-option label="收入" value="in" /><el-option label="支出" value="out" />
        </el-select>
      </template>
      <el-input v-if="kind === 'fund' || kind === 'hot' || kind === 'stocktake' || kind === 'stockSheet'" v-model="keyword" clearable
        :placeholder="kind === 'fund' ? '单号或备注' : '商品名称或编码'" style="width: 170px"
        @keyup.enter="refresh" @clear="refresh" />
      <el-button @click="refresh">刷新</el-button>
      <el-button v-if="hasPermission('data.export')" :loading="exporting" @click="exportReport">导出 CSV</el-button>
    </div>
    <p v-if="kind === 'profit'" class="note">按销售、零售和销售退货的历史成本计算。缺少成本流水时显示 —。</p>
    <p v-else-if="kind === 'stocktake'" class="note">显示已经入账的盘盈和盘亏记录，数量按商品基本单位计算。</p>
    <p v-else-if="kind === 'stockSheet'" class="note">显示各仓库和批次的当前库存数量。</p>
    <p v-else-if="kind === 'fund' && totals" class="note">
      对外收支合计 · 收入 ¥{{ totals.income.toFixed(2) }} · 支出 ¥{{ totals.expense.toFixed(2) }} · 净额 ¥{{ (totals.income - totals.expense).toFixed(2) }}
    </p>
    <el-table :key="kind" v-loading="loading" :data="rows" empty-text="所选日期内暂无记录" stripe>
      <el-table-column v-for="column in REPORT_COLUMNS[kind]" :key="column[0]" :label="column[1]"
        :align="column[2] ? 'right' : 'left'" min-width="105" show-overflow-tooltip>
        <template #default="{ row }">{{ display(row, column) }}</template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total"
      class="report-pager" layout="total, prev, pager, next" @current-change="load" />
  </el-card>
</template>

<style scoped>
.report-filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.note { color: var(--el-text-color-secondary); }
.report-pager { justify-content: flex-end; margin-top: 16px; }
</style>
