<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { purchaseApi } from '../../api/purchase'
import { supplierApi } from '../../api/supplier'
import { productApi } from '../../api/product'
import { fundApi } from '../../api/fund'
import type { DocRow } from '../../../../shared/types/doc'
import type { FundAccount } from '../../../../shared/types/fund'
import { warehouseApi } from '../../api/warehouse'
import type { Supplier } from '../../../../shared/types/supplier'
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
  price: number | null
  originalQty?: number
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
  account_id: null as number | null,
  remark: ''
})

const supplierOptions = ref<Supplier[]>([])
const accountOptions = ref<FundAccount[]>([])
const warehouseOptions = ref<Warehouse[]>([])
const lines = ref<Line[]>([emptyLine()])

function emptyLine(): Line {
  return { product_id: null, product: null, unit: '', rate: 1, unitOptions: [], batch_no: '', qty: null, price: null }
}

const saving = ref(false)
const source = ref<DocRow | null>(null)
const sourceOptions = ref<DocRow[]>([])
const loadingSource = ref(false)

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

async function searchSource(keyword: string): Promise<void> {
  try {
    sourceOptions.value = (await purchaseApi.query({
      type: 'purchase', page: 1, pageSize: 30, keyword: keyword || undefined
    })).items
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function selectSource(id: number | null | undefined): Promise<void> {
  if (!id) {
    source.value = null
    return
  }
  loadingSource.value = true
  try {
    const detail = await purchaseApi.getDetail(id)
    const partner = detail.doc.partner_id === null ? null : await supplierApi.get(detail.doc.partner_id)
    const originalLines = await Promise.all(detail.items.map(async (item) => {
      const product = await productApi.get(item.product_id)
      const unit = item.unit || product?.base_unit || ''
      return {
        product_id: item.product_id,
        product,
        unit,
        rate: item.rate,
        unitOptions: [{ unit, rate: item.rate }],
        batch_no: item.batch_no,
        qty: null,
        price: item.price,
        originalQty: item.qty
      }
    }))
    if (partner) supplierOptions.value = [partner, ...supplierOptions.value.filter((p) => p.id !== partner.id)]
    form.supplier_id = detail.doc.partner_id
    form.warehouse_id = detail.doc.warehouse_id
    lines.value = originalLines
    source.value = detail.doc
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loadingSource.value = false
  }
}

async function loadAccounts(): Promise<void> {
  try {
    accountOptions.value = (await fundApi.query({ page: 1, pageSize: 200 })).list
  } catch (e) {
    ElMessage.error((e as Error).message)
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
  const units: ProductUnit[] = p?.units ?? []
  const base: ProductUnit = { unit: p?.base_unit ?? '', rate: 1, is_base: true }
  line.unitOptions = [base, ...units]
  line.unit = base.unit ?? ''
  line.rate = 1
  line.batch_no = ''
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
  if (saving.value || loadingSource.value) return
  if (!form.warehouse_id) {
    ElMessage.warning('请选择仓库')
    return
  }
  const items = lines.value
    .filter((l) => l.product_id !== null && (l.qty ?? 0) > 0)
    .map((l) => ({
      product_id: l.product_id as number,
      batch_no: source.value || l.product?.tracking_type === 'batch' ? l.batch_no || undefined : undefined,
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
    const doc = await purchaseApi.createReturn({
      source_doc_id: source.value?.id,
      account_id: form.account_id ?? undefined,
      supplier_id: form.supplier_id ?? undefined,
      warehouse_id: form.warehouse_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/purchase/return-list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void searchSuppliers('')
void loadWarehouses()
void loadAccounts()
</script>

<template>
  <div class="purchase-return-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">采购退货单</h3>
        <div class="actions">
          <el-button @click="router.push('/purchase/return-list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="原采购单">
          <el-select
            :model-value="source?.id"
            filterable
            remote
            clearable
            :loading="loadingSource"
            :disabled="loadingSource"
            :remote-method="searchSource"
            placeholder="按单号查找，可留空"
            style="width: 220px"
            @focus="searchSource('')"
            @change="selectSource"
          >
            <el-option v-for="doc in sourceOptions" :key="doc.id" :label="doc.no" :value="doc.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="供应商">
          <el-select
            v-model="form.supplier_id"
            :disabled="source !== null"
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
          <el-select v-model="form.warehouse_id" :disabled="source !== null" placeholder="选择仓库" style="width: 180px">
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="退款账户">
          <el-select v-model="form.account_id" placeholder="留空冲减往来" clearable style="width: 180px">
            <el-option v-for="a in accountOptions" :key="a.id" :label="a.name" :value="a.id as number" />
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
            <span v-if="source">{{ row.product?.name ?? row.product_id }}</span>
            <el-select
              v-else
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
            <el-input-number v-model="row.qty" :placeholder="row.originalQty === undefined ? undefined : `原单 ${row.originalQty}`" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="批次号" width="120">
          <template #default="{ row }">
            <span v-if="source">{{ row.batch_no || '—' }}</span>
            <el-input v-else-if="row.product?.tracking_type === 'batch'" v-model="row.batch_no" placeholder="批次号" />
            <span v-else class="muted">—</span>
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
        <el-button v-if="!source" @click="addLine">添加商品</el-button>
        <div class="total">
          合计：<span class="total-amount">{{ totalAmount.toFixed(2) }}</span> 元
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.purchase-return-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.purchase-return-edit .title {
  margin: 0;
}
.purchase-return-edit .table {
  margin-top: 8px;
}
.purchase-return-edit .muted {
  color: var(--el-text-color-placeholder);
}
.purchase-return-edit .amount {
  font-variant-numeric: tabular-nums;
}
.purchase-return-edit .footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.purchase-return-edit .total-amount {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-danger);
}
</style>
