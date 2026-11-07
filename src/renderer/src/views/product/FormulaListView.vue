<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formulaApi, type FormulaRow } from '../../api/formula'
import { productApi } from '../../api/product'
import { hasPermission } from '../../stores/auth'
import type { Product } from '../../../../shared/types/product'

interface ItemRow {
  product_id: number | null
  qty: number
}

const list = ref<FormulaRow[]>([])
const products = ref<Product[]>([])
const searching = ref(false)
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)

const form = ref({
  name: '',
  output_product_id: null as number | null,
  output_qty: 1,
  remark: '',
  items: [] as ItemRow[]
})

const canEdit = computed(() => hasPermission('product.edit'))
const productMap = computed(() => new Map(products.value.map((p) => [p.id, p])))

function productName(id: number): string {
  const p = productMap.value.get(id)
  return p ? `${p.code} ${p.name}` : `商品 #${id}`
}

function itemsLabel(items: Array<{ product_id: number; qty: number }>): string {
  return items.map((it) => `${productName(it.product_id)}×${it.qty}`).join('，')
}

async function searchProducts(keyword: string): Promise<void> {
  searching.value = true
  try {
    const r = await productApi.query({ page: 1, pageSize: 100, keyword: keyword || undefined })
    products.value = r.list
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    searching.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await formulaApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.value = { name: '', output_product_id: null, output_qty: 1, remark: '', items: [{ product_id: null, qty: 1 }] }
  dialogVisible.value = true
}

function openEdit(row: FormulaRow): void {
  editingId.value = row.id
  form.value = {
    name: row.name,
    output_product_id: row.output_product_id,
    output_qty: row.output_qty,
    remark: row.remark ?? '',
    items: row.items.map((it) => ({ product_id: it.product_id, qty: it.qty }))
  }
  dialogVisible.value = true
}

function addItem(): void {
  form.value.items.push({ product_id: null, qty: 1 })
}

function removeItem(index: number): void {
  form.value.items.splice(index, 1)
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写配方名称')
    return
  }
  if (form.value.output_product_id === null) {
    ElMessage.warning('请选择产出商品')
    return
  }
  const items = form.value.items.filter((it) => it.product_id !== null)
  if (items.length === 0) {
    ElMessage.warning('请至少添加一个子件')
    return
  }
  if (items.some((it) => !(Number(it.qty) > 0))) {
    ElMessage.warning('子件数量必须大于0')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      output_product_id: form.value.output_product_id,
      output_qty: Number(form.value.output_qty) || 1,
      remark: form.value.remark || undefined,
      items: items.map((it) => ({ product_id: it.product_id as number, qty: Number(it.qty) }))
    }
    if (editingId.value === null) {
      await formulaApi.create(payload)
      ElMessage.success('配方已创建')
    } else {
      await formulaApi.update(editingId.value, payload)
      ElMessage.success('配方已保存')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function toggleDisable(row: FormulaRow): Promise<void> {
  try {
    if (row.disabled) {
      await formulaApi.enable(row.id)
      ElMessage.success('已启用')
    } else {
      await formulaApi.disable(row.id)
      ElMessage.success('已停用')
    }
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function remove(row: FormulaRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除配方「${row.name}」吗？删除后不可恢复。`, '删除配方', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await formulaApi.remove(row.id)
    ElMessage.success('配方已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

onMounted(() => {
  void load()
  void searchProducts('')
})
</script>

<template>
  <div class="formula-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">配方档案</h3>
        <div class="actions">
          <el-button v-if="canEdit" type="primary" @click="openCreate">新建配方</el-button>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </div>
      </div>

      <el-table :data="list" size="small" class="table" v-loading="loading" empty-text="暂无配方">
        <el-table-column prop="name" label="配方名称" min-width="160" />
        <el-table-column label="产出商品" min-width="160">
          <template #default="{ row }">{{ productName(row.output_product_id) }}</template>
        </el-table-column>
        <el-table-column prop="output_qty" label="产出数量" width="90" align="right" />
        <el-table-column label="子件" min-width="260">
          <template #default="{ row }">
            <span v-if="row.items.length === 0">—</span>
            <span v-else>
              {{ itemsLabel(row.items) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.disabled" type="danger" size="small">停用</el-tag>
            <el-tag v-else type="success" size="small">启用</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
        <el-table-column v-if="canEdit" label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="toggleDisable(row)">{{ row.disabled ? '启用' : '停用' }}</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新建配方' : '编辑配方'" width="640px">
      <el-form label-width="90px">
        <el-form-item label="配方名称" required>
          <el-input v-model="form.name" placeholder="如：礼品套装A" maxlength="100" />
        </el-form-item>
        <el-form-item label="产出商品" required>
          <el-select
            v-model="form.output_product_id"
            filterable
            remote
            :remote-method="searchProducts"
            :loading="searching"
            placeholder="选择产出商品"
            class="picker"
            @focus="searchProducts('')"
          >
            <el-option
              v-for="p in products"
              :key="p.id"
              :label="`${p.code} ${p.name}`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="产出数量">
          <el-input-number v-model="form.output_qty" :min="0.01" :step="1" />
        </el-form-item>
        <el-form-item label="子件" required>
          <div class="items">
            <div v-for="(it, index) in form.items" :key="index" class="item-row">
              <el-select
                v-model="it.product_id"
                filterable
                remote
                :remote-method="searchProducts"
                :loading="searching"
                placeholder="选择子件商品"
                class="item-picker"
                @focus="searchProducts('')"
              >
                <el-option v-for="p in products" :key="p.id" :label="`${p.code} ${p.name}`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.qty" :min="0.01" :step="1" class="item-qty" />
              <el-button link type="danger" @click="removeItem(index)">删除</el-button>
            </div>
            <el-button link type="primary" @click="addItem">+ 添加子件</el-button>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  margin: 0;
  font-size: 16px;
}
.actions {
  display: flex;
  gap: 8px;
}
.table {
  width: 100%;
}
.picker {
  width: 320px;
}
.items {
  width: 100%;
}
.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.item-picker {
  flex: 1;
}
.item-qty {
  width: 140px;
}
</style>
