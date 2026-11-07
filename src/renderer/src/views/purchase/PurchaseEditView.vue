<script setup lang="ts">
import TrackingFields from '../../components/TrackingFields.vue'
import type { TrackingItemInput } from '../../../../shared/types/inventory'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { purchaseApi } from '../../api/purchase'
import { supplierApi } from '../../api/supplier'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { workflowApi } from '../../api/workflow'
import { hasPermission } from '../../stores/auth'
import { useDocumentScanner } from '../../composables/useDocumentScanner'
import type { Supplier } from '../../../../shared/types/supplier'
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
  price: number | null
}


const router = useRouter()

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  date: today(),
  supplier_id: null as number | null,
  warehouse_id: null as number | null,
  remark: ''
})

const supplierOptions = ref<Supplier[]>([])
const warehouseOptions = ref<Warehouse[]>([])
const lines = ref<Line[]>([emptyLine()])

function emptyLine(): Line {
  return { product_id: null, product: null, unit: '', rate: 1, unitOptions: [], batch_no: '', qty: null, price: null }
}

const saving = ref(false)
const canPost = computed(() => hasPermission('doc.approve'))
const canSave = computed(() => hasPermission('doc.purchase') && (canPost.value || hasPermission('doc.workflow')))

const totalAmount = computed(() =>
  lines.value.reduce((sum, l) => sum + lineAmount(l), 0)
)

async function searchSuppliers(keyword: string): Promise<void> {
  try {
    const r = await supplierApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    supplierOptions.value = r.list
  } catch {
    /* 静默：远程搜索失败不阻断录入 */
  }
}

async function loadWarehouses(): Promise<void> {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouseOptions.value = r.list
    const first = warehouseOptions.value[0]
    if (first?.id !== undefined && form.warehouse_id === null) {
      form.warehouse_id = first.id
    }
  } catch {
    /* 静默 */
  }
}

async function searchProducts(keyword: string): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    productOptions.value = r.list
  } catch {
    /* 静默 */
  }
}

const productOptions = ref<Product[]>([])

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
  if (!p || p.purchase_price === undefined) {
    line.price = null
  } else {
    line.price = p.purchase_price
  }
}

function lineAmount(l: Line): number {
  return (l.qty ?? 0) * (l.price ?? 0)
}

function onUnitChange(line: Line): void {
  const u = line.unitOptions.find((x) => x.unit === line.unit)
  const rate = u?.rate ?? 1
  if (line.price !== null) line.price = (line.price / line.rate) * rate
  line.rate = rate
}

function addLine(): void {
  lines.value.push(emptyLine())
}

function removeLine(index: number): void {
  lines.value.splice(index, 1)
  if (lines.value.length === 0) lines.value.push(emptyLine())
}

async function save(): Promise<void> {
  if (!canSave.value) return
  if (!form.warehouse_id) {
    ElMessage.warning('请选择仓库')
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
      price: l.price ?? 0
    }))
  if (items.length === 0) {
    ElMessage.warning('请至少录入一条商品明细')
    return
  }
  saving.value = true
  try {
    if (!canPost.value) {
      await workflowApi.save({
        kind: 'purchase',
        partner_id: form.supplier_id ?? undefined,
        warehouse_id: form.warehouse_id,
        date: form.date || today(),
        remark: form.remark || undefined,
        items
      })
      ElMessage.success('进货草稿已保存，审核后过账')
      await router.push('/doc/workflow')
      return
    }
    const doc = await purchaseApi.create({
      supplier_id: form.supplier_id ?? undefined,
      warehouse_id: form.warehouse_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/purchase/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void searchSuppliers('')
void loadWarehouses()

// P1-7 扫码枪直接扫入开单页：命中条码/编码即填入最后一行空行（或已有行 +1）。
function fillScanned(p: Product): void {
  const existing = lines.value.find((l) => l.product_id === p.id)
  if (existing) {
    existing.qty = (existing.qty ?? 0) + 1
    ElMessage.info(`${p.name} 数量 +1（现 ${existing.qty}）`)
    return
  }
  const blank = [...lines.value].reverse().find((l) => l.product_id === null)
  const target = blank ?? (lines.value.push(emptyLine()), lines.value[lines.value.length - 1]!)
  target.product_id = p.id ?? null
  onProductSelect(target)
  // onProductSelect 从 productOptions 缓存取商品，扫码商品多半不在缓存，手工补齐
  target.product = p
  const units: ProductUnit[] = p.units ?? []
  const base: ProductUnit = { unit: p.base_unit, rate: 1, is_base: true }
  target.unitOptions = [base, ...units]
  target.unit = p.base_unit
  target.rate = 1
  target.price = p.purchase_price ?? null
  if (target.qty === null || (target.qty ?? 0) <= 0) target.qty = 1
  ElMessage.success(`已加：${p.name}`)
}
useDocumentScanner({ onProduct: fillScanned })
</script>

<template>
  <div class="purchase-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">进货单</h3>
        <div class="actions">
          <el-button @click="router.push('/purchase/list')">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">{{ canPost ? '保存' : '保存草稿' }}</el-button>
        </div>
      </div>

      <el-alert v-if="!canSave" type="info" show-icon :closable="false"
        title="保存进货单需要草稿或审核权限，请联系管理员分配权限。" />

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="供应商">
          <el-select
            v-model="form.supplier_id"
            filterable
            remote
            clearable
            :remote-method="searchSuppliers"
            placeholder="搜索并选择供应商"
            style="width: 220px"
          >
            <el-option
              v-for="s in supplierOptions"
              :key="s.id"
              :label="s.name"
              :value="s.id as number"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="选择仓库" style="width: 180px">
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
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            <el-select
              v-model="row.product_id"
              filterable
              remote
              :remote-method="(kw: string) => searchProducts(kw)"
              :loading="false"
              placeholder="搜索商品"
              @focus="searchProducts('')"
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
        <el-table-column label="数量" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="批次号" width="120">
          <template #default="{ row }">
            <el-input v-if="row.product?.tracking_type === 'batch'" v-model="row.batch_no" placeholder="批次号" />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="序列号 / 效期" min-width="180">
          <template #default="{ row }">
            <TrackingFields
              :tracking="row.product?.tracking_type"
              v-model:serial-numbers="row.serial_numbers"
              receive-batch
              v-model:production-date="row.production_date"
              v-model:expire-date="row.expire_date"
            />
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">
            <span class="amount">{{ lineAmount(row).toFixed(2) }}</span>
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
          合计：<span class="total-amount">{{ totalAmount.toFixed(2) }}</span> 元
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.purchase-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.purchase-edit .title {
  margin: 0;
}
.purchase-edit .table {
  margin-top: 8px;
}
.purchase-edit .muted {
  color: var(--el-text-color-placeholder);
}
.purchase-edit .amount {
  font-variant-numeric: tabular-nums;
}
.purchase-edit .footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.purchase-edit .total-amount {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-danger);
}
</style>
