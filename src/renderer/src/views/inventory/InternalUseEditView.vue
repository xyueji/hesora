<script setup lang="ts">
import TrackingFields from '../../components/TrackingFields.vue'
import type { TrackingItemInput } from '../../../../shared/types/inventory'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { internalUseApi } from '../../api/internal-use'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import type { Product, ProductUnit } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

interface Line extends TrackingItemInput {
  product_id: number | null
  product: Product | null
  unit: string
  rate: number
  unitOptions: ProductUnit[]
  batch_no: string
  qty: number | null
  receiver: string
  purpose: string
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
const lines = ref<Line[]>([emptyLine()])

function emptyLine(): Line {
  return {
    product_id: null,
    product: null,
    unit: '',
    rate: 1,
    unitOptions: [],
    batch_no: '',
    qty: null,
    receiver: '',
    purpose: ''
  }
}

const saving = ref(false)

const totalQty = computed(() =>
  lines.value.reduce((sum, l) => sum + (l.qty ?? 0) * (l.rate || 1), 0)
)

async function loadWarehouses(): Promise<void> {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouseOptions.value = r.list
  } catch {
    /* 静默 */
  }
}

const productOptions = ref<Product[]>([])

async function searchProducts(keyword: string, line: Line): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    productOptions.value = r.list
  } catch {
    /* 静默 */
  }
  void line
}

function onProductSelect(line: Line): void {
  const p = productOptions.value.find((x) => x.id === line.product_id)
  line.product = p ?? null
  line.serial_numbers = undefined
  line.production_date = undefined
  line.expire_date = undefined
  const units: ProductUnit[] = p?.units ?? []
  const base: ProductUnit = { unit: p?.base_unit ?? '', rate: 1, is_base: true }
  line.unitOptions = [base, ...units]
  line.unit = base.unit ?? ''
  line.rate = 1
}

function onUnitChange(line: Line): void {
  const u = line.unitOptions.find((x) => x.unit === line.unit)
  line.rate = u?.rate ?? 1
}

function addLine(): void {
  lines.value.push(emptyLine())
}

function removeLine(index: number): void {
  lines.value.splice(index, 1)
  if (lines.value.length === 0) lines.value.push(emptyLine())
}

async function save(): Promise<void> {
  if (!form.warehouse_id) {
    ElMessage.warning('请选择领用仓库')
    return
  }
  const items = lines.value
    .filter((l) => l.product_id !== null && (l.qty ?? 0) > 0)
    .map((l) => ({
      product_id: l.product_id as number,
      serial_numbers: l.serial_numbers,
      production_date: l.production_date || undefined,
      expire_date: l.expire_date || undefined,
      batch_no: l.product?.tracking_type === 'batch' ? l.batch_no || '' : undefined,
      unit: l.unit || undefined,
      rate: l.rate || 1,
      qty: l.qty as number,
      receiver: l.receiver || undefined,
      purpose: l.purpose || undefined
    }))
  if (items.length === 0) {
    ElMessage.warning('请至少录入一条商品明细')
    return
  }
  saving.value = true
  try {
    const doc = await internalUseApi.create({
      warehouse_id: form.warehouse_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/inventory/internal-use')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void loadWarehouses()
</script>

<template>
  <div class="internal-use-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">内部领用单</h3>
        <div class="actions">
          <el-button @click="router.push('/inventory/internal-use')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="领用仓" required>
          <el-select v-model="form.warehouse_id" placeholder="领用仓库" style="width: 180px">
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="备注" style="width: 260px" />
        </el-form-item>
      </el-form>

      <el-table :data="lines" stripe class="table" empty-text="点击下方按钮添加商品">
        <el-table-column label="商品" min-width="200">
          <template #default="{ row }">
            <el-select
              v-model="row.product_id"
              filterable
              remote
              :remote-method="(kw: string) => searchProducts(kw, row)"
              placeholder="搜索商品"
              @focus="searchProducts('', row)"
              @change="onProductSelect(row)"
              style="width: 100%"
            >
              <el-option
                v-for="p in productOptions"
                :key="p.id"
                :label="`${p.code} ${p.name}`"
                :value="p.id as number"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="100">
          <template #default="{ row }">
            <el-select v-model="row.unit" :disabled="row.unitOptions.length <= 1" @change="onUnitChange(row)" style="width: 100%">
              <el-option v-for="u in row.unitOptions" :key="u.unit" :label="u.unit" :value="u.unit" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="批次号" width="120">
          <template #default="{ row }">
            <el-input v-if="row.product?.tracking_type === 'batch'" v-model="row.batch_no" placeholder="批次号" />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="序列号 / 效期" min-width="160">
          <template #default="{ row }">
            <TrackingFields
              :tracking="row.product?.tracking_type"
              v-model:serial-numbers="row.serial_numbers"
            />
          </template>
        </el-table-column>
        <el-table-column label="数量" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="领用人" width="120">
          <template #default="{ row }">
            <el-input v-model="row.receiver" placeholder="领用人" maxlength="30" />
          </template>
        </el-table-column>
        <el-table-column label="用途" width="150">
          <template #default="{ row }">
            <el-input v-model="row.purpose" placeholder="用途" maxlength="50" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="removeLine($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="footer">
        <el-button @click="addLine">添加商品</el-button>
        <div class="total">
          合计数量：<span class="total-qty">{{ totalQty }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.internal-use-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.internal-use-edit .title {
  margin: 0;
}
.internal-use-edit .table {
  margin-top: 8px;
}
.internal-use-edit .muted {
  color: var(--el-text-color-placeholder);
}
.internal-use-edit .footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.internal-use-edit .total-qty {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-primary);
}
</style>
