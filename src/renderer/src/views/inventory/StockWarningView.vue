<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockReportApi } from '../../api/stock-report'
import { warehouseApi } from '../../api/warehouse'
import type { UnsoldRow, WarningRow } from '../../../../shared/types/stock-report'

const keyword = ref('')
const warehouseId = ref<number | undefined>(undefined)
const loading = ref(false)
const items = ref<WarningRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const warehouses = ref<{ id: number; name: string }[]>([])
const sumQty = ref(0)
const sumDiff = ref(0)
const sumCount = ref(0)

/** 单个商品设置预警值 */
const singleVisible = ref(false)
const singleRow = ref<WarningRow | null>(null)
const singleMinStock = ref(0)

/** 批量设置预警值 */
const batchVisible = ref(false)
const batchKeyword = ref('')
const batchCurrent = ref<number | undefined>(undefined)
const batchMinStock = ref(0)

function fmt(n: number): string {
  return n.toFixed(2)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await stockReportApi.warnings({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value
    })
    items.value = r.items
    total.value = r.total
    sumQty.value = r.totals.qty
    sumDiff.value = r.totals.diff
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
  page.value = 1
  void load()
}

function summaryMethod(): string[] {
  return [
    '',
    '合计',
    '',
    '',
    fmt(sumQty.value),
    '',
    fmt(sumDiff.value),
    `${sumCount.value} 项`,
    ''
  ]
}

// ── S 级：滞销商品（有库存但近 N 天无销售出库）──
const activeTab = ref('warning')
const unsoldDays = ref(30)
const unsoldLoading = ref(false)
const unsoldItems = ref<UnsoldRow[]>([])

async function loadUnsold(): Promise<void> {
  unsoldLoading.value = true
  try {
    unsoldItems.value = await stockReportApi.unsold({
      days: unsoldDays.value,
      warehouse_id: warehouseId.value
    })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    unsoldLoading.value = false
  }
}

function searchUnsold(): void {
  void loadUnsold()
}

function openSingle(row: WarningRow): void {  singleRow.value = row
  singleMinStock.value = row.min_stock
  singleVisible.value = true
}

async function submitSingle(): Promise<void> {
  const row = singleRow.value
  if (!row) return
  try {
    await stockReportApi.setWarning(row.product_id, singleMinStock.value)
    ElMessage.success(`已设置「${row.name}」预警值为 ${singleMinStock.value}`)
    singleVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function openBatch(): void {
  batchKeyword.value = ''
  batchCurrent.value = undefined
  batchMinStock.value = 0
  batchVisible.value = true
}

async function submitBatch(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将把符合筛选条件的商品的预警值统一设置为新值，是否继续？',
      '批量设置预警值',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const r = await stockReportApi.setWarningsByCondition(
      {
        keyword: batchKeyword.value || undefined,
        min_stock: batchCurrent.value
      },
      batchMinStock.value
    )
    ElMessage.success(`已更新 ${r.updated} 个商品的预警值`)
    batchVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
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
  void loadUnsold()
})
</script>

<template>
  <div class="stock-warning">
    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="库存预警" name="warning">
      <div class="toolbar">
        <h3 class="title">库存预警</h3>
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
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button type="warning" plain @click="openBatch">批量设置预警值</el-button>
        </div>
      </div>

      <el-table
        :data="items"
        v-loading="loading"
        border
        show-summary
        :summary-method="summaryMethod"
        empty-text="暂无预警商品"
      >
        <el-table-column prop="code" label="商品编码" min-width="110" />
        <el-table-column prop="name" label="商品名称" min-width="140" />
        <el-table-column prop="spec" label="规格" min-width="100" />
        <el-table-column prop="base_unit" label="单位" width="70" />
        <el-table-column prop="qty" label="当前库存" align="right" width="100" />
        <el-table-column prop="min_stock" label="预警值(下限)" align="right" width="110" />
        <el-table-column label="上限" align="right" width="90">
          <template #default="{ row }">{{ row.max_stock ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="diff" label="差额" align="right" width="90" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.status === '缺货'" type="danger" size="small">缺货</el-tag>
            <el-tag v-else-if="row.status === '超储'" type="danger" effect="plain" size="small">超储</el-tag>
            <el-tag v-else type="warning" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSingle(row)">设置预警值</el-button>
          </template>
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
        </el-tab-pane>

        <el-tab-pane label="滞销商品" name="unsold">
          <div class="toolbar">
            <div class="filters">
              <span class="unit">近</span>
              <el-input-number v-model="unsoldDays" :min="1" :max="3650" :step="10" @change="searchUnsold" />
              <span class="unit">天无销售出库</span>
              <el-button type="primary" @click="searchUnsold">查询</el-button>
            </div>
          </div>
          <el-table
            :data="unsoldItems"
            v-loading="unsoldLoading"
            border
            empty-text="没有符合条件的滞销商品"
          >
            <el-table-column prop="code" label="商品编码" min-width="110" />
            <el-table-column prop="name" label="商品名称" min-width="140" />
            <el-table-column prop="spec" label="规格" min-width="100" />
            <el-table-column prop="base_unit" label="单位" width="70" />
            <el-table-column prop="qty" label="当前库存" align="right" width="100" />
            <el-table-column label="状态" width="100">
              <template #default>
                <el-tag type="warning" size="small">滞销</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <p class="dlg-tip">口径：有库存（数量 &gt; 0）但近 N 天内无销售/零售出库记录的商品。</p>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="singleVisible" title="设置预警值" width="360px">
      <div v-if="singleRow" class="dlg-body">
        <p class="dlg-tip">
          商品：{{ singleRow.name }}（{{ singleRow.code }}） 当前库存 {{ singleRow.qty }}
        </p>
        <el-form label-width="90px">
          <el-form-item label="预警值">
            <el-input-number v-model="singleMinStock" :min="0" :precision="0" :step="1" />
            <span class="unit">（{{ singleRow.base_unit }}）</span>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="singleVisible = false">取消</el-button>
        <el-button type="primary" @click="submitSingle">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchVisible" title="批量设置预警值" width="420px">
      <el-form label-width="110px">
        <el-form-item label="商品关键字">
          <el-input v-model="batchKeyword" placeholder="编码或名称，留空表示全部商品" clearable />
        </el-form-item>
        <el-form-item label="当前预警值">
          <el-input-number v-model="batchCurrent" :min="0" :precision="0" :step="1" placeholder="不限" />
          <span class="unit">（留空表示不限）</span>
        </el-form-item>
        <el-form-item label="新的预警值">
          <el-input-number v-model="batchMinStock" :min="0" :precision="0" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatch">确定</el-button>
      </template>
    </el-dialog>
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
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.dlg-tip {
  margin: 0 0 12px;
  color: #606266;
}
.unit {
  margin-left: 8px;
  color: #909399;
}
</style>
