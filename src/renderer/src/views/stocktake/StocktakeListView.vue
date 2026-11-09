<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { stocktakeApi, type StocktakeDetail, type StocktakeImportRow } from '../../api/stocktake'
import type { Warehouse } from '../../../../shared/types/warehouse'
import { warehouseApi } from '../../api/warehouse'
import { productApi } from '../../api/product'
import type { DocRow, DocItemRow } from '../../../../shared/types/doc'

const router = useRouter()

const keyword = ref('')
const dateRange = ref<[string, string] | null>(null)
const loading = ref(false)
const list = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const warehouseNames = ref<Record<number, string>>({})
const productNames = ref<Record<number, string>>({})

const detailVisible = ref(false)
const detail = ref<StocktakeDetail | null>(null)

// P2：盘点复盘
const reviewVisible = ref(false)
const reviewForm = ref({ review_by: '', review_remark: '' })

function openReview(): void {
  if (!detail.value) return
  reviewForm.value = { review_by: '', review_remark: detail.value.doc.review_remark ?? '' }
  reviewVisible.value = true
}

async function doReview(): Promise<void> {
  if (!detail.value) return
  const by = reviewForm.value.review_by.trim()
  if (!by) {
    ElMessage.warning('请填写复盘人')
    return
  }
  try {
    const doc = await stocktakeApi.review(detail.value.doc.id, by, reviewForm.value.review_remark || undefined)
    ElMessage.success('复盘已记录')
    reviewVisible.value = false
    detail.value = { ...detail.value, doc }
  } catch (e) {
    ElMessage.error((e as Error).message || '复盘失败')
  }
}

/** 盘点结论：按明细差异符号汇总 */
function conclusionType(items: Array<{ qty: number }>): 'success' | 'warning' {
  return items.some((i) => i.qty !== 0) ? 'warning' : 'success'
}

function stocktakeConclusion(items: Array<{ qty: number }>): string {
  const gains = items.filter((i) => i.qty > 0).length
  const losses = items.filter((i) => i.qty < 0).length
  if (gains === 0 && losses === 0) return '相符'
  const parts: string[] = []
  if (gains > 0) parts.push(`盘盈 ${gains} 项`)
  if (losses > 0) parts.push(`盘亏 ${losses} 项`)
  return parts.join('、')
}

// 盘点 CSV 导入
const importVisible = ref(false)
const importLoading = ref(false)
const importCsv = ref('')
const importWarehouseId = ref<number | undefined>()
const importDate = ref<string | null>(null)
const importWarehouses = ref<Warehouse[]>([])
const importResult = ref<{ rows: StocktakeImportRow[]; errors: Array<{ row: number; message: string }> } | null>(null)

function openImport(): void {
  importCsv.value = ''
  importResult.value = null
  importVisible.value = true
}

async function doImport(): Promise<void> {
  if (!importWarehouseId.value) {
    ElMessage.warning('请选择仓库')
    return
  }
  importLoading.value = true
  try {
    const res = await stocktakeApi.importSheet(
      importCsv.value,
      importWarehouseId.value,
      importDate.value || undefined
    )
    importResult.value = { rows: res.rows, errors: res.errors }
    if (res.errors.length === 0) ElMessage.success(`解析成功，共 ${res.rows.length} 行，请到「开盘点单」确认过账`)
    else ElMessage.warning(`解析完成：有效 ${res.rows.length} 行，错误 ${res.errors.length} 行`)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    importLoading.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await stocktakeApi.query({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    })
    list.value = r.items
    total.value = r.total
    await loadNames(r.items)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function loadNames(rows: DocRow[]): Promise<void> {
  const whIds = [...new Set(rows.map((r) => r.warehouse_id).filter((v): v is number => v !== null))]
  for (const id of whIds) {
    if (warehouseNames.value[id]) continue
    try {
      const w = await warehouseApi.get(id)
      warehouseNames.value[id] = w?.name ?? `#${id}`
    } catch {
      warehouseNames.value[id] = `#${id}`
    }
  }
  for (const row of rows) {
    try {
      const d = await stocktakeApi.getDetail(row.id)
      const ids = [...new Set(d.items.map((i) => i.product_id))]
      for (const pid of ids) {
        if (productNames.value[pid]) continue
        const p = await productApi.get(pid)
        productNames.value[pid] = p ? `${p.code} ${p.name}` : `#${pid}`
      }
    } catch {
      /* 忽略：弹窗打开时会再次加载 */
    }
  }
}

function search(): void {
  page.value = 1
  void load()
}

async function viewDetail(row: DocRow): Promise<void> {
  try {
    detail.value = await stocktakeApi.getDetail(row.id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function productName(item: DocItemRow): string {
  return productNames.value[item.product_id] ?? `#${item.product_id}`
}

function whName(id: number | null): string {
  return id === null ? '—' : (warehouseNames.value[id] ?? `#${id}`)
}

onMounted(() => {
  void load()
  void warehouseApi
    .query({ page: 1, pageSize: 100 })
    .then((r) => {
      importWarehouses.value = r.list
    })
    .catch(() => {
      importWarehouses.value = []
    })
})
</script>

<template>
  <div class="stocktake-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">盘点单</h3>
        <div class="actions">
          <el-button @click="openImport">导入盘点</el-button>
          <el-button type="primary" @click="router.push('/stocktake/edit')">新增盘点</el-button>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
            @change="search"
          />
          <el-input
            v-model="keyword"
            placeholder="搜索单号"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe class="table">
        <el-table-column prop="no" label="单号" width="180" />
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column label="盘点仓" min-width="120">
          <template #default="{ row }">{{ whName(row.warehouse_id) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />
    </el-card>

    <el-dialog v-model="detailVisible" title="盘点单详情" width="760px">
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="desc">
          <el-descriptions-item label="单号">{{ detail.doc.no }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detail.doc.date }}</el-descriptions-item>
          <el-descriptions-item label="盘点仓">{{ whName(detail.doc.warehouse_id) }}</el-descriptions-item>
          <el-descriptions-item label="结论">
            <el-tag :type="conclusionType(detail.items)">{{ stocktakeConclusion(detail.items) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="3">{{ detail.doc.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="复盘人">{{ detail.doc.review_by || '未复盘' }}</el-descriptions-item>
          <el-descriptions-item label="复盘时间">{{ detail.doc.review_at || '—' }}</el-descriptions-item>
          <el-descriptions-item label="复盘备注">{{ detail.doc.review_remark || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" stripe size="small">
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">{{ productName(row) }}</template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column prop="batch_no" label="批次号" width="100" />
          <el-table-column label="差异(盘盈+/盘亏-)" width="140" align="right">
            <template #default="{ row }">
              <span :class="row.qty > 0 ? 'diff-in' : 'diff-out'">{{ row.qty > 0 ? '+' : '' }}{{ row.qty }}</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detail && !detail.doc.review_by" type="primary" @click="openReview">复盘</el-button>
        <el-button v-else-if="detail && detail.doc.review_by" @click="openReview">重新复盘</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="reviewVisible" title="盘点复盘" width="420px">
      <el-form label-width="80px">
        <el-form-item label="复盘人">
          <el-input v-model="reviewForm.review_by" placeholder="复盘人姓名" maxlength="40" />
        </el-form-item>
        <el-form-item label="复盘备注">
          <el-input v-model="reviewForm.review_remark" type="textarea" :rows="3" placeholder="复盘结论/备注（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" @click="doReview">保存复盘</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="importVisible" title="导入盘点（CSV）" width="720px">
      <el-form label-width="80px">
        <el-form-item label="仓库">
          <el-select v-model="importWarehouseId" placeholder="选择仓库" style="width: 200px">
            <el-option v-for="w in importWarehouses" :key="w.id" :label="w.name" :value="w.id!" />
          </el-select>
        </el-form-item>
        <el-form-item label="盘点日期">
          <el-date-picker v-model="importDate" type="date" value-format="YYYY-MM-DD" placeholder="默认今天" />
        </el-form-item>
        <el-form-item label="CSV 内容">
          <el-input v-model="importCsv" type="textarea" :rows="8"
            placeholder="商品编码,实盘数量[,批次号]&#10;P001,80&#10;P002,60,B1" />
        </el-form-item>
      </el-form>
      <template v-if="importResult">
        <el-alert v-if="importResult.errors.length" type="warning" :closable="false"
          :title="`错误行 ${importResult.errors.length} 条`" style="margin-bottom: 8px" />
        <el-table :data="importResult.rows" size="small" border max-height="220">
          <el-table-column prop="product_code" label="商品编码" width="110" />
          <el-table-column prop="product_name" label="商品名称" min-width="120" />
          <el-table-column prop="batch_no" label="批次" width="90">
            <template #default="{ row }">{{ row.batch_no || '—' }}</template>
          </el-table-column>
          <el-table-column prop="book_qty" label="账面" width="80" align="right" />
          <el-table-column prop="actual_qty" label="实盘" width="80" align="right" />
          <el-table-column prop="diff" label="差异" width="80" align="right" />
        </el-table>
        <el-table v-if="importResult.errors.length" :data="importResult.errors" size="small" border max-height="160" style="margin-top: 8px">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="message" label="错误" min-width="240" />
        </el-table>
      </template>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importLoading" @click="doImport">解析</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stocktake-list .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.stocktake-list .title {
  margin: 0;
}
.stocktake-list .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.stocktake-list .search {
  width: 220px;
}
.stocktake-list .pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.stocktake-list .diff-in {
  color: var(--el-color-success);
  font-weight: 600;
}
.stocktake-list .diff-out {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
