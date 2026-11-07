<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { customerApi } from '../../api/customer'
import { productApi } from '../../api/product'
import { customerPriceApi } from '../../api/customer-price'
import { hasPermission } from '../../stores/auth'
import type { Customer } from '../../../../shared/types/customer'
import type { Product } from '../../../../shared/types/product'
import type { CustomerPriceRow, PriceChangeLogRow } from '../../../../shared/types/customer-price'

const canEdit = hasPermission('product.price')

const customers = ref<Customer[]>([])
const customerKeyword = ref('')
const selectedCustomerId = ref<number | null>(null)
const activeTab = ref<'prices' | 'log'>('prices')

const prices = ref<CustomerPriceRow[]>([])
const logs = ref<PriceChangeLogRow[]>([])
const products = ref<Product[]>([])
const productMap = ref<Map<number, Product>>(new Map())

// 编辑中的行：product_id -> price
const editing = reactive<Record<number, number>>({})

const selectedCustomer = computed(() =>
  customers.value.find((c) => c.id === selectedCustomerId.value) ?? null
)

async function searchCustomers(keyword: string): Promise<void> {
  try {
    const r = await customerApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    customers.value = r.list
    if (selectedCustomerId.value !== null && !r.list.some((c) => c.id === selectedCustomerId.value)) {
      selectedCustomerId.value = null
    }
  } catch {
    /* 静默：搜索失败不阻断 */
  }
}
searchCustomers('')

async function searchProducts(keyword: string): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 100, keyword: keyword || undefined })
    products.value = r.list
    const m = new Map<number, Product>()
    for (const p of r.list) if (p.id !== undefined) m.set(p.id, p)
    productMap.value = m
  } catch {
    /* 静默 */
  }
}
searchProducts('')

async function loadPrices(): Promise<void> {
  editingClear()
  if (selectedCustomerId.value === null) {
    prices.value = []
    return
  }
  try {
    prices.value = await customerPriceApi.listByCustomer(selectedCustomerId.value)
  } catch (e) {
    prices.value = []
    ElMessage.error((e as Error).message || '读取客户专属价失败')
  }
}

async function loadLogs(): Promise<void> {
  try {
    logs.value = await customerPriceApi.changeLog(
      selectedCustomerId.value !== null ? { customer_id: selectedCustomerId.value } : {}
    )
  } catch (e) {
    logs.value = []
    ElMessage.error((e as Error).message || '读取变价历史失败')
  }
}

watch(selectedCustomerId, () => {
  void loadPrices()
  void loadLogs()
})

function editingClear(): void {
  for (const k of Object.keys(editing)) delete editing[Number(k)]
}

function productName(productId: number): string {
  return productMap.value.get(productId)?.name ?? `商品#${productId}`
}

function productRetail(productId: number): number | undefined {
  return productMap.value.get(productId)?.retail_price
}

/** 新增行：选择商品 + 输入价格 */
const newLine = reactive({ product_id: null as number | null, price: null as number | null })

async function addPrice(): Promise<void> {
  if (selectedCustomerId.value === null || newLine.product_id === null) return
  if (newLine.price === null || !Number.isFinite(newLine.price) || newLine.price < 0) {
    ElMessage.warning('请输入不小于 0 的价格')
    return
  }
  try {
    await customerPriceApi.set(selectedCustomerId.value, newLine.product_id, newLine.price)
    ElMessage.success('专属价已保存')
    newLine.product_id = null
    newLine.price = null
    await loadPrices()
    await loadLogs()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  }
}

function startEdit(row: CustomerPriceRow): void {
  editing[row.product_id] = row.price
}

async function saveEdit(row: CustomerPriceRow): Promise<void> {
  const price = editing[row.product_id]
  if (price === undefined || price === row.price) {
    delete editing[row.product_id]
    return
  }
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('价格必须是不小于 0 的数字')
    return
  }
  try {
    await customerPriceApi.set(selectedCustomerId.value as number, row.product_id, price)
    ElMessage.success('专属价已更新')
    delete editing[row.product_id]
    await loadPrices()
    await loadLogs()
  } catch (e) {
    ElMessage.error((e as Error).message || '更新失败')
  }
}

function cancelEdit(row: CustomerPriceRow): void {
  delete editing[row.product_id]
}

async function removePrice(row: CustomerPriceRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除「${selectedCustomer.value?.name ?? ''} — ${productName(row.product_id)}」的专属价吗？删除后按价格等级/零售价取价。`,
      '删除专属价',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await customerPriceApi.remove(selectedCustomerId.value as number, row.product_id)
    ElMessage.success('已删除')
    await loadPrices()
    await loadLogs()
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

const scopeLabel: Record<string, string> = {
  customer_product: '客户专属价',
  price_level: '价格等级'
}

function logTitle(row: PriceChangeLogRow): string {
  const cus = row.customer_id ? `客户#${row.customer_id} ` : ''
  return `${scopeLabel[row.scope] ?? row.scope} ${cus}${productName(row.product_id)}`
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select
        v-model="selectedCustomerId"
        filterable
        remote
        clearable
        placeholder="选择客户"
        :remote-method="searchCustomers"
        style="width: 260px"
      >
        <el-option v-for="c in customers" :key="c.id" :label="c.name" :value="c.id ?? 0" />
      </el-select>
      <el-input
        v-model="customerKeyword"
        placeholder="客户名称/编号"
        clearable
        style="width: 200px"
        @input="searchCustomers(customerKeyword)"
      />
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="专属价" name="prices">
        <div v-if="selectedCustomerId === null" class="empty-hint">请先选择客户</div>
        <template v-else>
          <div v-if="canEdit" class="add-row">
            <el-select v-model="newLine.product_id" filterable placeholder="选择商品" style="width: 260px">
              <el-option
                v-for="p in products"
                :key="p.id"
                :label="`${p.code} ${p.name}（零售 ¥${p.retail_price}）`"
                :value="p.id ?? 0"
              />
            </el-select>
            <el-input-number v-model="newLine.price" :min="0" :precision="2" controls-position="right" placeholder="价格" />
            <el-button type="primary" @click="addPrice">新增专属价</el-button>
          </div>

          <el-table :data="prices" border>
            <el-table-column label="商品" min-width="160">
              <template #default="{ row }">{{ productName(row.product_id) }}</template>
            </el-table-column>
            <el-table-column label="零售价" width="100">
              <template #default="{ row }">¥{{ productRetail(row.product_id) ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="专属价" width="180">
              <template #default="{ row }">
                <template v-if="editing[row.product_id] !== undefined">
                  <el-input-number
                    v-model="editing[row.product_id]"
                    :min="0"
                    :precision="2"
                    size="small"
                    controls-position="right"
                    style="width: 110px"
                  />
                  <el-button size="small" type="primary" link @click="saveEdit(row)">保存</el-button>
                  <el-button size="small" link @click="cancelEdit(row)">取消</el-button>
                </template>
                <template v-else>
                  ¥{{ row.price }}
                  <el-button v-if="canEdit" size="small" link type="primary" @click="startEdit(row)">改价</el-button>
                </template>
              </template>
            </el-table-column>
            <el-table-column prop="updated_at" label="更新时间" width="170" />
            <el-table-column v-if="canEdit" label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" link type="danger" @click="removePrice(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-tab-pane>

      <el-tab-pane label="变价历史" name="log">
        <el-table :data="logs" border>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">{{ scopeLabel[row.scope] ?? row.scope }}</template>
          </el-table-column>
          <el-table-column label="对象" min-width="200">
            <template #default="{ row }">{{ logTitle(row) }}</template>
          </el-table-column>
          <el-table-column label="原价" width="100">
            <template #default="{ row }">{{ row.old_price ?? '-' }}</template>
          </el-table-column>
          <el-table-column prop="new_price" label="新价" width="100" />
          <el-table-column prop="operator" label="操作人" width="120">
            <template #default="{ row }">{{ row.operator || '-' }}</template>
          </el-table-column>
          <el-table-column prop="created_at" label="时间" width="170" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 12px; }
.add-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
.empty-hint { color: var(--el-text-color-secondary); padding: 24px 0; text-align: center; }
</style>
