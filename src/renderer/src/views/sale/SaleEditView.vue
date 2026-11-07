<script setup lang="ts">
import TrackingFields from '../../components/TrackingFields.vue'
import type { TrackingItemInput } from '../../../../shared/types/inventory'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { saleApi } from '../../api/sale'
import { customerApi } from '../../api/customer'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { workflowApi } from '../../api/workflow'
import { customerPriceApi } from '../../api/customer-price'
import { watch } from 'vue'
import { hasPermission } from '../../stores/auth'
import type { Customer } from '../../../../shared/types/customer'
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
  /** 用户手动改过价：客户变化时不自动覆盖 */
  priceManual: boolean
}


const router = useRouter()

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  date: today(),
  customer_id: null as number | null,
  warehouse_id: null as number | null,
  remark: ''
})

const customerOptions = ref<Customer[]>([])
const warehouseOptions = ref<Warehouse[]>([])
const lines = ref<Line[]>([emptyLine()])

function emptyLine(): Line {
  return { product_id: null, product: null, unit: '', rate: 1, unitOptions: [], batch_no: '', qty: null, price: null, priceManual: false }
}

const saving = ref(false)
const canPost = computed(() => hasPermission('doc.approve'))
const canSave = computed(() => hasPermission('doc.sale') && (canPost.value || hasPermission('doc.workflow')))

const totalAmount = computed(() =>
  lines.value.reduce((sum, l) => sum + lineAmount(l), 0)
)

async function searchCustomers(keyword: string): Promise<void> {
  try {
    const r = await customerApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    customerOptions.value = r.list
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
  // 售价默认带出零售价（选中客户后由按客户取价逻辑覆盖）
  line.priceManual = false
  if (!p || p.retail_price === undefined) {
    line.price = null
  } else {
    line.price = p.retail_price
  }
}

/** 按客户取价：刷新未手动改价的行（专属价 > 等级价 > 零售价，由服务端解析） */
async function applyCustomerPrices(): Promise<void> {
  if (form.customer_id === null) return
  try {
    const specials = await customerPriceApi.listByCustomer(form.customer_id)
    const specialMap = new Map<number, number>()
    for (const s of specials) specialMap.set(s.product_id, s.price)
    for (const l of lines.value) {
      if (l.product_id === null || l.priceManual) continue
      const special = specialMap.get(l.product_id)
      if (special !== undefined) {
        l.price = special / l.rate
      } else {
        // 无专属价时回退零售价
        const p = productOptions.value.find((x) => x.id === l.product_id)
        if (p?.retail_price !== undefined) l.price = p.retail_price
      }
    }
  } catch {
    /* 静默：取价失败不影响录单 */
  }
}

watch(() => form.customer_id, () => void applyCustomerPrices())

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
        kind: 'sale',
        partner_id: form.customer_id ?? undefined,
        warehouse_id: form.warehouse_id,
        date: form.date || today(),
        remark: form.remark || undefined,
        items
      })
      ElMessage.success('销售草稿已保存，审核后过账')
      await router.push('/doc/workflow')
      return
    }
    const doc = await saleApi.create({
      customer_id: form.customer_id ?? undefined,
      warehouse_id: form.warehouse_id,
      date: form.date || undefined,
      remark: form.remark || undefined,
      items
    })
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/sale/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void searchCustomers('')
void loadWarehouses()
</script>

<template>
  <div class="sale-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">销售单</h3>
        <div class="actions">
          <el-button @click="router.push('/sale/list')">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">{{ canPost ? '保存' : '保存草稿' }}</el-button>
        </div>
      </div>

      <el-alert v-if="!canSave" type="info" show-icon :closable="false"
        title="保存销售单需要草稿或审核权限，请联系管理员分配权限。" />

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="客户">
          <el-select
            v-model="form.customer_id"
            filterable
            remote
            clearable
            :remote-method="searchCustomers"
            placeholder="搜索并选择客户"
            style="width: 220px"
          >
            <el-option
              v-for="c in customerOptions"
              :key="c.id"
              :label="c.name"
              :value="c.id as number"
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
        <el-table-column label="售价" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" controls-position="right" style="width: 100%" @change="row.priceManual = true" />
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
.sale-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.sale-edit .title {
  margin: 0;
}
.sale-edit .table {
  margin-top: 8px;
}
.sale-edit .muted {
  color: var(--el-text-color-placeholder);
}
.sale-edit .amount {
  font-variant-numeric: tabular-nums;
}
.sale-edit .footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.sale-edit .total-amount {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-danger);
}
</style>
