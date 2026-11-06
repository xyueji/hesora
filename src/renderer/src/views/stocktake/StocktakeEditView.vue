<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { stocktakeApi } from '../../api/stocktake'
import { warehouseApi } from '../../api/warehouse'
import type { StocktakeSheetRow } from '../../../../shared/types/stocktake'
import type { Warehouse } from '../../../../shared/types/warehouse'

interface SheetLine extends StocktakeSheetRow {
  actual_qty: number
}

const router = useRouter()

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  date: today(),
  warehouse_id: null as number | null,
  remark: ''
})

const warehouseOptions = ref<Warehouse[]>([])
const keyword = ref('')
const lines = ref<SheetLine[]>([])
const loaded = ref(false)
const loading = ref(false)
const saving = ref(false)

async function loadWarehouses(): Promise<void> {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouseOptions.value = r.list
  } catch {
    /* 静默 */
  }
}

async function loadSheet(): Promise<void> {
  if (!form.warehouse_id) {
    ElMessage.warning('请选择盘点仓库')
    return
  }
  loading.value = true
  try {
    const rows = await stocktakeApi.getSheet(form.warehouse_id, keyword.value || undefined)
    lines.value = rows.map((r) => ({ ...r, actual_qty: r.book_qty }))
    loaded.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

// 差异 = 实盘 - 账面；仅展示，保存时服务端再次计算
function diffOf(row: SheetLine): number {
  return Number((row.actual_qty - row.book_qty).toFixed(4))
}

const diffCount = computed(() => lines.value.filter((l) => diffOf(l) !== 0).length)

async function save(): Promise<void> {
  if (!form.warehouse_id) {
    ElMessage.warning('请选择盘点仓库')
    return
  }
  const items = lines.value
    .filter((l) => diffOf(l) !== 0)
    .map((l) => ({
      product_id: l.product_id,
      batch_no: l.batch_no || undefined,
      unit: l.unit || undefined,
      rate: 1,
      actual_qty: l.actual_qty
    }))
  if (items.length === 0) {
    ElMessage.warning('没有需要盘点的差异行')
    return
  }
  saving.value = true
  try {
    const doc = await stocktakeApi.create({
      warehouse_id: form.warehouse_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/stocktake/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void loadWarehouses()
</script>

<template>
  <div class="stocktake-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">盘点单</h3>
        <div class="actions">
          <el-button @click="router.push('/stocktake/list')">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="!loaded" @click="save">
            保存（{{ diffCount }} 条差异）
          </el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="盘点仓" required>
          <el-select
            v-model="form.warehouse_id"
            placeholder="选择仓库"
            style="width: 180px"
            @change="loaded = false; lines = []"
          >
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="备注" style="width: 240px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="loadSheet">加载账面库存</el-button>
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="keyword"
            placeholder="商品编码/名称过滤"
            clearable
            style="width: 200px"
            @keyup.enter="loadSheet"
            @clear="loadSheet"
          />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="loaded && lines.length === 0"
        title="该仓库当前无账面库存"
        type="info"
        :closable="false"
        class="tip"
      />

      <el-table v-loading="loading" :data="lines" stripe class="table" empty-text="选择仓库后点击「加载账面库存」">
        <el-table-column prop="product_code" label="商品编码" width="110" />
        <el-table-column prop="product_name" label="商品名称" min-width="140" />
        <el-table-column prop="spec" label="规格" min-width="90" />
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="batch_no" label="批次号" width="110" />
        <el-table-column prop="book_qty" label="账面数量" width="100" align="right" />
        <el-table-column label="实盘数量" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.actual_qty" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="差异" width="90" align="right">
          <template #default="{ row }">
            <span :class="diffOf(row) !== 0 ? (diffOf(row) > 0 ? 'diff-in' : 'diff-out') : ''">
              {{ diffOf(row) > 0 ? '+' : '' }}{{ diffOf(row) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.stocktake-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.stocktake-edit .title {
  margin: 0;
}
.stocktake-edit .table {
  margin-top: 8px;
}
.stocktake-edit .tip {
  margin-top: 8px;
}
.stocktake-edit .diff-in {
  color: var(--el-color-success);
  font-weight: 600;
}
.stocktake-edit .diff-out {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
