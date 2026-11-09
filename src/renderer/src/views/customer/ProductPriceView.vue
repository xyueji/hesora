<script setup lang="ts">
// P2：按商品视角管理客户专属价——选商品 → 列出全部客户对该商品的专属价，支持增删改与批量设置。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { customerApi } from '../../api/customer'
import { productApi } from '../../api/product'
import { customerPriceApi } from '../../api/customer-price'
import { hasPermission } from '../../stores/auth'
import type { Customer } from '../../../../shared/types/customer'
import type { Product } from '../../../../shared/types/product'
import type { CustomerPriceRow } from '../../../../shared/types/customer-price'

const canEdit = hasPermission('product.price')

const products = ref<Product[]>([])
const productKeyword = ref('')
const selectedProductId = ref<number | null>(null)

const prices = ref<CustomerPriceRow[]>([])
const customers = ref<Customer[]>([])
const customerMap = ref<Map<number, Customer>>(new Map())

const editing = reactive<Record<number, number>>({})
const newLine = reactive({ customer_id: null as number | null, price: null as number | null })
// 批量设置：全部客户统一改为该价（仅对已有专属价行生效）
const bulkPrice = ref<number | null>(null)

const selectedProduct = computed(
  () => products.value.find((p) => p.id === selectedProductId.value) ?? null
)

async function searchProducts(keyword: string): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 100, keyword: keyword || undefined })
    products.value = r.list
    if (selectedProductId.value !== null && !r.list.some((p) => p.id === selectedProductId.value)) {
      selectedProductId.value = null
    }
  } catch {
    /* 静默 */
  }
}
searchProducts('')

async function loadCustomers(): Promise<void> {
  try {
    const r = await customerApi.query({ page: 1, pageSize: 200 })
    customers.value = r.list
    const m = new Map<number, Customer>()
    for (const c of r.list) if (c.id !== undefined) m.set(c.id, c)
    customerMap.value = m
  } catch {
    /* 静默 */
  }
}
void loadCustomers()

async function loadPrices(): Promise<void> {
  for (const k of Object.keys(editing)) delete editing[Number(k)]
  if (selectedProductId.value === null) {
    prices.value = []
    return
  }
  try {
    prices.value = await customerPriceApi.listByProduct(selectedProductId.value)
  } catch (e) {
    prices.value = []
    ElMessage.error((e as Error).message || '读取商品专属价失败')
  }
}

watch(selectedProductId, () => void loadPrices())

function customerName(customerId: number): string {
  return customerMap.value.get(customerId)?.name ?? `客户#${customerId}`
}

async function addPrice(): Promise<void> {
  if (selectedProductId.value === null || newLine.customer_id === null) return
  if (newLine.price === null || !Number.isFinite(newLine.price) || newLine.price < 0) {
    ElMessage.warning('请输入不小于 0 的价格')
    return
  }
  try {
    await customerPriceApi.set(newLine.customer_id, selectedProductId.value, newLine.price)
    ElMessage.success('专属价已保存')
    newLine.customer_id = null
    newLine.price = null
    await loadPrices()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  }
}

async function saveEdit(row: CustomerPriceRow): Promise<void> {
  const price = editing[row.customer_id]
  if (price === undefined || price === row.price) {
    delete editing[row.customer_id]
    return
  }
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('价格必须是不小于 0 的数字')
    return
  }
  try {
    await customerPriceApi.set(row.customer_id, selectedProductId.value as number, price)
    ElMessage.success('专属价已更新')
    delete editing[row.customer_id]
    await loadPrices()
  } catch (e) {
    ElMessage.error((e as Error).message || '更新失败')
  }
}

async function removePrice(row: CustomerPriceRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除「${customerName(row.customer_id)} — ${selectedProduct.value?.name ?? ''}」的专属价吗？`,
      '删除专属价',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await customerPriceApi.remove(row.customer_id, selectedProductId.value as number)
    ElMessage.success('已删除')
    await loadPrices()
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

/** 批量设置：把列表中所有客户的专属价统一改为输入值 */
async function bulkSet(): Promise<void> {
  if (selectedProductId.value === null) return
  const price = bulkPrice.value
  if (price === null || !Number.isFinite(price) || price < 0) {
    ElMessage.warning('请输入不小于 0 的批量价格')
    return
  }
  if (prices.value.length === 0) {
    ElMessage.warning('当前商品暂无专属价记录')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将 ${prices.value.length} 个客户的专属价统一改为 ¥${price}，确认？`,
      '批量设置',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  let ok = 0
  for (const row of prices.value) {
    try {
      await customerPriceApi.set(row.customer_id, selectedProductId.value as number, price)
      ok += 1
    } catch {
      /* 单个失败继续 */
    }
  }
  ElMessage.success(`批量设置完成（${ok}/${prices.value.length}）`)
  bulkPrice.value = null
  await loadPrices()
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select
        v-model="selectedProductId"
        filterable
        clearable
        placeholder="选择商品"
        style="width: 300px"
      >
        <el-option
          v-for="p in products"
          :key="p.id"
          :label="`${p.code} ${p.name}（零售 ¥${p.retail_price}）`"
          :value="p.id ?? 0"
        />
      </el-select>
      <el-input
        v-model="productKeyword"
        placeholder="商品编码/名称"
        clearable
        style="width: 200px"
        @input="searchProducts(productKeyword)"
      />
    </div>

    <div v-if="selectedProductId === null" class="empty-hint">请先选择商品</div>
    <template v-else>
      <div v-if="canEdit" class="add-row">
        <el-select v-model="newLine.customer_id" filterable placeholder="选择客户" style="width: 240px">
          <el-option v-for="c in customers" :key="c.id" :label="c.name" :value="c.id ?? 0" />
        </el-select>
        <el-input-number v-model="newLine.price" :min="0" :precision="2" controls-position="right" placeholder="价格" />
        <el-button type="primary" @click="addPrice">新增专属价</el-button>
        <el-divider direction="vertical" />
        <el-input-number v-model="bulkPrice" :min="0" :precision="2" controls-position="right" placeholder="批量价格" />
        <el-button @click="bulkSet">批量设置全部</el-button>
      </div>

      <el-table :data="prices" border>
        <el-table-column label="客户" min-width="160">
          <template #default="{ row }">{{ customerName(row.customer_id) }}</template>
        </el-table-column>
        <el-table-column label="专属价" width="180">
          <template #default="{ row }">
            <template v-if="editing[row.customer_id] !== undefined">
              <el-input-number
                v-model="editing[row.customer_id]"
                :min="0"
                :precision="2"
                size="small"
                controls-position="right"
                style="width: 110px"
              />
              <el-button size="small" type="primary" link @click="saveEdit(row)">保存</el-button>
              <el-button size="small" link @click="delete editing[row.customer_id]">取消</el-button>
            </template>
            <template v-else>
              ¥{{ row.price }}
              <el-button v-if="canEdit" size="small" link type="primary" @click="editing[row.customer_id] = row.price">改价</el-button>
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
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 12px; }
.add-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
.empty-hint { color: var(--el-text-color-secondary); padding: 24px 0; text-align: center; }
</style>
