<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { assembleApi } from '../../api/assemble'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { inventoryApi } from '../../api/inventory'
import type { Product } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

const router = useRouter()

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = ref({
  type: 'assemble' as 'assemble' | 'disassemble',
  date: today(),
  warehouse_id: null as number | null,
  combo_id: null as number | null,
  qty: null as number | null,
  remark: ''
})

const warehouseOptions = ref<Warehouse[]>([])
const comboOptions = ref<Product[]>([])
const combo = ref<Product | null>(null)
const saving = ref(false)

const isAssemble = computed(() => form.value.type === 'assemble')

async function loadWarehouses(): Promise<void> {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouseOptions.value = r.list
  } catch {
    /* 静默 */
  }
}

async function searchCombos(keyword: string): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined, kind: 'combo' })
    comboOptions.value = r.list
  } catch {
    /* 静默 */
  }
}

async function onComboSelect(): Promise<void> {
  combo.value = comboOptions.value.find((p) => p.id === form.value.combo_id) ?? null
  if (combo.value) await loadStock()
}

// 子件当前库存（可用量预览）与名称
const childStock = ref<Record<number, number>>({})
const childNames = ref<Record<number, string>>({})

async function loadStock(): Promise<void> {
  if (!form.value.warehouse_id || !combo.value?.bom) return
  const map: Record<number, number> = {}
  try {
    const r = await inventoryApi.queryStock({
      warehouse_id: form.value.warehouse_id,
      page: 1,
      pageSize: 500
    })
    for (const row of r.items) map[row.product_id] = row.qty
  } catch {
    /* 忽略：预览可选 */
  }
  childStock.value = map
  for (const b of combo.value.bom) {
    if (childNames.value[b.product_id]) continue
    try {
      const p = await productApi.get(b.product_id)
      childNames.value[b.product_id] = p ? `${p.code} ${p.name}` : `#${b.product_id}`
    } catch {
      childNames.value[b.product_id] = `#${b.product_id}`
    }
  }
}

// BOM 预览行
const bomPreview = computed(() => {
  const qty = form.value.qty ?? 0
  return (combo.value?.bom ?? []).map((b) => ({
    product_id: b.product_id,
    unit_qty: b.qty,
    need_qty: b.qty * qty
  }))
})

function childName(pid: number): string {
  return childNames.value[pid] ?? `#${pid}`
}

async function save(): Promise<void> {
  if (!form.value.warehouse_id) {
    ElMessage.warning('请选择仓库')
    return
  }
  if (!form.value.combo_id) {
    ElMessage.warning('请选择组合商品')
    return
  }
  if (!form.value.qty || form.value.qty <= 0) {
    ElMessage.warning('数量必须大于0')
    return
  }
  saving.value = true
  try {
    const payload = {
      warehouse_id: form.value.warehouse_id,
      combo_id: form.value.combo_id,
      qty: form.value.qty,
      date: form.value.date || undefined,
      remark: form.value.remark || undefined
    }
    const doc = isAssemble.value ? await assembleApi.create(payload) : await assembleApi.disassemble(payload)
    ElMessage.success(`保存成功：${doc.no}`)
    router.push('/assemble/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

void loadWarehouses()
void searchCombos('')
</script>

<template>
  <div class="assemble-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isAssemble ? '组装单' : '拆卸单' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/assemble/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio-button value="assemble">组装</el-radio-button>
            <el-radio-button value="disassemble">拆卸</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouse_id" placeholder="仓库" style="width: 180px" @change="loadStock">
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="组合商品" required>
          <el-select
            v-model="form.combo_id"
            filterable
            remote
            :remote-method="searchCombos"
            placeholder="搜索组合商品"
            style="width: 240px"
            @focus="searchCombos('')"
            @change="onComboSelect"
          >
            <el-option
              v-for="p in comboOptions"
              :key="p.id"
              :label="`${p.code} ${p.name}`"
              :value="p.id as number"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.qty" :min="0" :precision="2" controls-position="right" style="width: 140px" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="备注" style="width: 240px" />
        </el-form-item>
      </el-form>

      <div v-if="combo" class="bom-preview">
        <div class="section-title">BOM 明细预览（{{ isAssemble ? '消耗' : '产出' }}）</div>
        <el-table :data="bomPreview" size="small" class="bom-table" empty-text="该组合商品未配置 BOM">
          <el-table-column label="子件" min-width="200">
            <template #default="{ row }">
              <el-tag v-if="childStock[row.product_id] !== undefined" size="small" class="stock-tag">
                库存 {{ childStock[row.product_id] }}
              </el-tag>
              {{ childName(row.product_id) }}
            </template>
          </el-table-column>
          <el-table-column label="单位数量" width="120" align="right">
            <template #default="{ row }">×{{ row.unit_qty }}</template>
          </el-table-column>
          <el-table-column label="需求量" width="140" align="right">
            <template #default="{ row }">{{ row.need_qty }}</template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.assemble-edit .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.assemble-edit .title {
  margin: 0;
}
.assemble-edit .bom-preview {
  margin-top: 8px;
}
.assemble-edit .section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 8px 0 12px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
}
.assemble-edit .bom-table {
  max-width: 560px;
}
.assemble-edit .stock-tag {
  margin-right: 8px;
}
</style>
