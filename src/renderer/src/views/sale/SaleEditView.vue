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
import { useDocumentScanner } from '../../composables/useDocumentScanner'
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
  /** P3：提成率%（下单时从商品带出，可改） */
  commission_rate: number | null
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
  remark: '',
  // P1 功能 #2 预存款抵扣金额（≤ 客户预存款余额）
  prepaid_amount: null as number | null,
  // 让利闭环：整单优惠（立减）金额，< 商品合计
  preferential_amount: null as number | null,
  // ── S 级功能批次 B：[3] 外部订单号、[7] 发票状态、[9] 发货信息 ──
  external_no: '',
  invoice_status: 'none' as 'none' | 'invoiced',
  express_com: '',
  express_no: '',
  delivery_status: 'none' as 'none' | 'shipped'
})

const customerOptions = ref<Customer[]>([])
const warehouseOptions = ref<Warehouse[]>([])
const lines = ref<Line[]>([emptyLine()])
const customerPrepaid = ref(0)

function emptyLine(): Line {
  return { product_id: null, product: null, unit: '', rate: 1, unitOptions: [], batch_no: '', qty: null, price: null, commission_rate: null, priceManual: false }
}

const saving = ref(false)
const canPost = computed(() => hasPermission('doc.approve'))
const canSave = computed(() => hasPermission('doc.sale') && (canPost.value || hasPermission('doc.workflow')))

const grossAmount = computed(() =>
  lines.value.reduce((sum, l) => sum + lineAmount(l), 0)
)
// 折后合计 = 商品合计 − 整单优惠（实时显示，与后端 total_amount 口径一致）
const totalAmount = computed(() =>
  Math.max(0, grossAmount.value - (form.preferential_amount ?? 0))
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

// ── S 级：售价低于成本提醒（仅 UI 提示，不阻断开单）──
// 成本口径：product:costMap 返回的加权平均移动成本（inventory.moving_cost 按正库存加权）。
const costMap = ref<Record<number, number>>({})

async function refreshCostMap(ids: number[]): Promise<void> {
  const need = ids.filter((id) => !(id in costMap.value))
  if (need.length === 0) return
  try {
    const m = await productApi.costMap(need)
    costMap.value = { ...costMap.value, ...m }
  } catch {
    /* 静默：成本获取失败不影响录单，仅少提示 */
  }
}

function costOf(productId: number | null): number | null {
  if (productId === null) return null
  const c = costMap.value[productId]
  return typeof c === 'number' && c > 0 ? c : null
}

/** 售价低于成本时返回提示文案（黄色行内警示），否则 null */
function belowCostHint(line: { product_id: number | null; price: number | null }): string | null {
  const cost = costOf(line.product_id)
  if (cost === null || line.price === null || line.price === undefined) return null
  if (line.price < cost) return `低于成本价 ${cost.toFixed(2)}`
  return null
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
  // 售价默认带出零售价（选中客户后由按客户取价逻辑覆盖）
  line.priceManual = false
  // P3：提成率从商品带出
  line.commission_rate = p?.commission_rate ?? null
  if (!p || p.retail_price === undefined) {
    line.price = null
  } else {
    line.price = p.retail_price
  }
  if (line.product_id !== null) void refreshCostMap([line.product_id])
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

watch(() => form.customer_id, async (id) => {
  // P1 功能 #2：切换客户时刷新预存款余额展示
  customerPrepaid.value = 0
  form.prepaid_amount = null
  if (id !== null) {
    try {
      const c = await customerApi.get(id)
      customerPrepaid.value = c?.prepaid ?? 0
    } catch {
      /* 静默：余额展示失败不阻断录入 */
    }
  }
  void applyCustomerPrices()
})

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
      price: l.price ?? 0,
      commission_rate: l.commission_rate ?? 0
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
      prepaid_amount: form.prepaid_amount && form.prepaid_amount > 0 ? form.prepaid_amount : undefined,
      preferential_amount:
        form.preferential_amount && form.preferential_amount > 0 ? form.preferential_amount : undefined,
      // ── S 级功能批次 B：[3][7][9] ──
      external_no: form.external_no.trim() || undefined,
      invoice_status: form.invoice_status,
      express_com: form.express_com.trim() || undefined,
      express_no: form.express_no.trim() || undefined,
      delivery_status: form.delivery_status,
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

// P1-7 扫码枪直接扫入开单页：命中条码/编码即填入最后一行空行（或已有行 +1）。
// 价格沿用 onProductSelect 的零售价默认，随后 applyCustomerPrices 会按客户覆盖。
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
  target.product = p
  const units: ProductUnit[] = p.units ?? []
  const base: ProductUnit = { unit: p.base_unit, rate: 1, is_base: true }
  target.unitOptions = [base, ...units]
  target.unit = p.base_unit
  target.rate = 1
  target.price = p.retail_price ?? null
  target.priceManual = false
  if (target.qty === null || (target.qty ?? 0) <= 0) target.qty = 1
  ElMessage.success(`已加：${p.name}`)
  if (form.customer_id !== null) void applyCustomerPrices()
}
useDocumentScanner({ onProduct: fillScanned })
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
        <el-form-item v-if="form.customer_id !== null" label="预存款">
          <span class="prepaid-balance">余额 ¥{{ customerPrepaid.toFixed(2) }}</span>
          <el-input-number
            v-model="form.prepaid_amount"
            :min="0"
            :max="Math.min(customerPrepaid, totalAmount)"
            :precision="2"
            :controls="false"
            placeholder="使用预存款"
            style="width: 140px; margin-left: 10px"
          />
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
        <!-- [3] 外部订单号（S 级功能批次 B） -->
        <el-form-item label="外部单号">
          <el-input v-model="form.external_no" placeholder="电商平台订单号等" style="width: 200px" />
        </el-form-item>
        <!-- [7] 发票状态（S 级功能批次 B） -->
        <el-form-item label="发票">
          <el-select v-model="form.invoice_status" style="width: 120px">
            <el-option label="未开票" value="none" />
            <el-option label="已开票" value="invoiced" />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 让利闭环：整单优惠折叠区 -->
      <el-collapse class="express-collapse">
        <el-collapse-item title="整单优惠">
          <el-form label-width="90px" inline>
            <el-form-item label="整单立减">
              <el-input-number
                v-model="form.preferential_amount"
                :min="0"
                :max="grossAmount > 0 ? grossAmount : 0"
                :precision="2"
                :controls="false"
                placeholder="0.00"
                style="width: 160px"
              />
            </el-form-item>
            <el-form-item label="折后合计">
              <span class="total-amount">{{ totalAmount.toFixed(2) }}</span> 元
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

      <!-- [9] 发货信息折叠区（S 级功能批次 B） -->
      <el-collapse class="express-collapse">
        <el-collapse-item title="发货信息">
          <el-form label-width="90px" inline>
            <el-form-item label="快递公司">
              <el-input v-model="form.express_com" placeholder="如：顺丰" style="width: 160px" />
            </el-form-item>
            <el-form-item label="快递单号">
              <el-input v-model="form.express_no" placeholder="快递单号" style="width: 200px" />
            </el-form-item>
            <el-form-item label="发货状态">
              <el-select v-model="form.delivery_status" style="width: 120px">
                <el-option label="未发货" value="none" />
                <el-option label="已发货" value="shipped" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

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
        <el-table-column label="售价" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" controls-position="right" style="width: 100%" @change="row.priceManual = true" />
            <div v-if="belowCostHint(row)" class="below-cost-hint">{{ belowCostHint(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提成率%" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.commission_rate" :min="0" :max="100" :precision="2" controls-position="right" style="width: 100%" />
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
/* [9] 发货信息折叠区（S 级功能批次 B） */
.express-collapse {
  margin-bottom: 16px;
}
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
/* S 级：售价低于成本的行内黄色警示（仅提示，不阻断开单） */
.below-cost-hint {
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.4;
}
</style>
