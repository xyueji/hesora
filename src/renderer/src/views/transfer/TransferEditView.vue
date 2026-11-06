<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { transferApi } from '../../api/transfer'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import type { Product, ProductUnit } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

interface Line {
  product_id: number | null
  product: Product | null
  unit: string
  rate: number
  unitOptions: ProductUnit[]
  batch_no: string
  qty: number | null
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
  warehouse_in_id: null as number | null,
  remark: ''
})

const warehouseOptions = ref<Warehouse[]>([])
const lines = ref<Line[]>([emptyLine()])

function emptyLine(): Line {
  return { product_id: null, product: null, unit: '', rate: 1, unitOptions: [], batch_no: '', qty: null }
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

// 调入仓选项排除已选调出仓
const inWarehouseOptions = computed(() =>
  warehouseOptions.value.filter((w) => w.id !== form.warehouse_id)
)

function onOutWarehouseChange(): void {
  if (form.warehouse_in_id !== null && form.warehouse_in_id === form.warehouse_id) {
    form.warehouse_in_id = null
  }
}

const productOptions = ref<Product[]>([])
let currentLine: Line | null = null

async function searchProducts(keyword: string, line: Line): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    productOptions.value = r.list
    currentLine = line
  } catch {
    /* 静默 */
  }
}

function onProductSelect(line: Line): void {
  const p = productOptions.value.find((x) => x.id === line.product_id)
  line.product = p ?? null
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
    ElMessage.warning('请选择调出仓库')
    return
  }
  if (!form.warehouse_in_id) {
    ElMessage.warning('请选择调入仓库')
    return
  }
  const items = lines.value
    .filter((l) => l.product_id !== null && (l.qty ?? 0) > 0)
    .map((l) => ({
      product_id: l.product_id as number,
      batch_no: l.product?.tracking_type === 'batch' ? l.batch_no || '' : undefined,
      unit: l.unit || undefined,
      rate: l.rate || 1,
      qty: l.qty as number
    }))
  if (items.length === 0) {
    ElMessage.warning('请至少录入一条商品明细')
    return
  }
  saving.value = true
  try {
    const doc = await transferApi.create({
      warehouse_id: form.warehouse_id,
      warehouse_in_id: form.warehouse_in_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/transfer/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void loadWarehouses()
void currentLine
</script>

<template>
  <div class="transfer-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">调拨单</h3>
        <div class="actions">
          <el-button @click="router.push('/transfer/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="调出仓" required>
          <el-select
            v-model="form.warehouse_id"
            placeholder="调出仓库"
            style="width: 180px"
            @change="onOutWarehouseChange"
          >
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="调入仓" required>
          <el-select v-model="form.warehouse_in_id" placeholder="调入仓库" style="width: 180px">
            <el-option v-for="w in inWarehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
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
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            <el-select
              v-model="row.product_id"
              filterable
              remote
              :remote-method="(kw: string) => searchProducts(kw, row)"
              :loading="false"
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
        <el-table-column label="单位" width="110">
          <template #default="{ row }">
            <el-select v-model="row.unit" :disabled="row.unitOptions.length <= 1" @change="onUnitChange(row)" style="width: 100%">
              <el-option v-for="u in row.unitOptions" :key="u.unit" :label="u.unit" :value="u.unit" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="批次号" width="130">
          <template #default="{ row }">
            <el-input v-if="row.product?.tracking_type === 'batch'" v-model="row.batch_no" placeholder="批次号" />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="0" :precision="2" controls-position="right" style="width: 100%" />
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
.transfer-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.transfer-edit .title {
  margin: 0;
}
.transfer-edit .table {
  margin-top: 8px;
}
.transfer-edit .muted {
  color: var(--el-text-color-placeholder);
}
.transfer-edit .footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.transfer-edit .total-qty {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-primary);
}
</style>
