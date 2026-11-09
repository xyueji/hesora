<script setup lang="ts">
// P2：采购建议——列出 min_stock>0 且现库存不足的商品，一键生成采购草稿单（purchase.create 直接过账）。
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockReportApi } from '../../api/stock-report'
import { warehouseApi } from '../../api/warehouse'
import { supplierApi } from '../../api/supplier'
import { purchaseApi } from '../../api/purchase'
import { hasPermission } from '../../stores/auth'
import type { PurchaseSuggestion } from '../../../../shared/types/stock-report'
import type { Warehouse } from '../../../../shared/types/warehouse'
import type { Supplier } from '../../../../shared/types/supplier'

const router = useRouter()
const canCreate = hasPermission('doc.approve')

const warehouses = ref<Warehouse[]>([])
const suppliers = ref<Supplier[]>([])
const suggestions = ref<PurchaseSuggestion[]>([])
const loading = ref(false)
const generating = ref(false)
const selected = ref<number[]>([])

const draft = reactive({
  warehouse_id: null as number | null,
  supplier_id: null as number | null,
  date: today(),
  remark: '采购建议自动生成'
})

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const totalQty = computed(() =>
  suggestions.value
    .filter((s) => selected.value.includes(s.product_id))
    .reduce((sum, s) => sum + s.suggest_qty, 0)
)

async function load(): Promise<void> {
  loading.value = true
  try {
    suggestions.value = await stockReportApi.purchaseSuggestions(draft.warehouse_id ?? undefined)
    selected.value = suggestions.value.map((s) => s.product_id)
  } catch (e) {
    ElMessage.error((e as Error).message || '读取采购建议失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const [whs, sups] = await Promise.all([
      warehouseApi.query({ page: 1, pageSize: 100 }),
      supplierApi.query({ page: 1, pageSize: 100 })
    ])
    warehouses.value = whs.list
    suppliers.value = sups.list
  } catch {
    /* 静默 */
  }
  await load()
})

async function generate(): Promise<void> {
  if (draft.warehouse_id === null) {
    ElMessage.warning('请先选择目标仓库')
    return
  }
  const items = suggestions.value
    .filter((s) => selected.value.includes(s.product_id))
    .map((s) => ({
      product_id: s.product_id,
      qty: s.suggest_qty,
      price: s.min_stock > 0 ? undefined : 0
    }))
  if (items.length === 0) {
    ElMessage.warning('请至少勾选一条建议')
    return
  }
  const count = items.length
  try {
    await ElMessageBox.confirm(
      `将按 ${count} 条建议生成采购草稿单（${totalQty.value} 基本单位）并直接过账入库，确认？`,
      '生成采购单',
      { type: 'info', confirmButtonText: '生成并过账', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  generating.value = true
  try {
    const doc = await purchaseApi.create({
      warehouse_id: draft.warehouse_id,
      supplier_id: draft.supplier_id ?? undefined,
      date: draft.date || undefined,
      remark: draft.remark || undefined,
      items: items.map((it) => ({
        product_id: it.product_id,
        qty: it.qty,
        price: 0
      }))
    })
    ElMessage.success(`采购单已生成并过账：${doc.no}`)
    await router.push('/purchase/list')
  } catch (e) {
    ElMessage.error((e as Error).message || '生成采购单失败')
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select
        v-model="draft.warehouse_id"
        clearable
        placeholder="全部仓库"
        style="width: 200px"
        @change="load"
      >
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id ?? 0" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新建议</el-button>
    </div>

    <div class="draft-bar">
      <el-select v-model="draft.supplier_id" clearable filterable placeholder="供应商（可选）" style="width: 220px">
        <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id ?? 0" />
      </el-select>
      <el-date-picker v-model="draft.date" type="date" value-format="YYYY-MM-DD" placeholder="单据日期" />
      <el-input v-model="draft.remark" placeholder="备注" style="width: 240px" />
      <el-button
        v-if="canCreate"
        type="primary"
        :loading="generating"
        :disabled="selected.length === 0"
        @click="generate"
      >
        一键生成采购单（{{ selected.length }} 项 / {{ totalQty }}）
      </el-button>
      <span v-else class="hint">无过账权限（doc.approve），只能查看建议</span>
    </div>

    <el-table :data="suggestions" border v-loading="loading" @selection-change="(rows: PurchaseSuggestion[]) => (selected = rows.map((r) => r.product_id))">
      <el-table-column type="selection" width="45" />
      <el-table-column prop="code" label="商品编码" width="140" />
      <el-table-column prop="name" label="商品名称" min-width="160" />
      <el-table-column prop="spec" label="规格" width="120" />
      <el-table-column prop="base_unit" label="单位" width="80" />
      <el-table-column prop="min_stock" label="最低库存" width="100" />
      <el-table-column prop="current_qty" label="当前库存" width="100">
        <template #default="{ row }">
          <span class="danger">{{ row.current_qty }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="suggest_qty" label="建议采购量" width="110">
        <template #default="{ row }">
          <el-tag type="warning">{{ row.suggest_qty }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && suggestions.length === 0" class="empty-hint">
      当前没有库存低于安全线的商品
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 12px; }
.draft-bar { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
.empty-hint { color: var(--el-text-color-secondary); padding: 24px 0; text-align: center; }
.danger { color: var(--el-color-danger); font-weight: 600; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
