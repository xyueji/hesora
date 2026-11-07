<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { csvApi, readCsvFile } from '../../api/csv'
import { hasPermission } from '../../stores/auth'
import { openingApi } from '../../api/opening'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import type { Product } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'
import type { Customer } from '../../../../shared/types/customer'
import type { Supplier } from '../../../../shared/types/supplier'
import type { OpeningPayload } from '../../../../shared/types/opening'

interface InvLine {
  product_id: number | null
  warehouse_id: number | null
  batch_no: string
  qty: number
  unit_cost: number
}
interface PartLine { ref_id: number | null; amount: number }

const loading = ref(false)
const saving = ref(false)
const done = ref(false)

const warehouses = ref<Warehouse[]>([])
const customers = ref<Customer[]>([])
const suppliers = ref<Supplier[]>([])

const invLines = reactive<InvLine[]>([])
const customerLines = reactive<PartLine[]>([])
const supplierLines = reactive<PartLine[]>([])

const productOptions = ref<Map<number, Product>>(new Map())
const importedProductLabels = ref<Record<number, string>>({})
const productSearching = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const importWarehouse = ref<number | null>(null)
const importing = ref(false)
const exportingTemplate = ref(false)

async function downloadStockTemplate(): Promise<void> {
  exportingTemplate.value = true
  try {
    const path = await csvApi.export('opening-stock-template')
    ElMessage.success(`已保存模板到 ${path}`)
  } catch (e) {
    const message = (e as Error).message
    if (message !== '已取消导出') ElMessage.error(message)
  } finally {
    exportingTemplate.value = false
  }
}

async function importStock(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const warehouseId = importWarehouse.value
  input.value = ''
  if (!file || warehouseId === null) return
  importing.value = true
  try {
    const result = await csvApi.previewOpeningStock(await readCsvFile(file))
    for (const line of result.lines) {
      importedProductLabels.value[line.product_id] = `${line.product_code} ${line.product_name}`
      invLines.push({ product_id: line.product_id, warehouse_id: warehouseId, batch_no: line.batch_no ?? '', qty: line.qty, unit_cost: line.unit_cost })
    }
    if (result.errors.length > 0) {
      await ElMessageBox.alert(result.errors.map((error) => `第 ${error.row} 行：${error.message}`).join('\n'), `已载入 ${result.lines.length} 行，失败 ${result.errors.length} 行`, { type: 'warning' })
    } else if (result.lines.length > 0) {
      ElMessage.success(`已载入 ${result.lines.length} 行，请核对后保存期初数据`)
    } else {
      ElMessage.warning('文件中没有期初库存数据')
    }
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    importing.value = false
  }
}

function addInvLine(): void {
  invLines.push({ product_id: null, warehouse_id: warehouses.value[0]?.id ?? null, batch_no: '', qty: 0, unit_cost: 0 })
}
function addCustomerLine(): void {
  customerLines.push({ ref_id: null, amount: 0 })
}
function addSupplierLine(): void {
  supplierLines.push({ ref_id: null, amount: 0 })
}

async function searchProducts(query: string): Promise<void> {
  productSearching.value = true
  try {
    const r = await productApi.query({ page: 1, pageSize: 20, keyword: query || undefined })
    const map = new Map<number, Product>()
    for (const p of r.list) map.set(p.id!, p)
    productOptions.value = map
  } finally {
    productSearching.value = false
  }
}


async function loadStatus(): Promise<void> {
  done.value = (await openingApi.getStatus()).done
}

onMounted(async () => {
  loading.value = true
  try {
    const [whs, cs, ss] = await Promise.all([
      warehouseApi.query({ page: 1, pageSize: 100 }),
      customerApi.query({ page: 1, pageSize: 1000 }),
      supplierApi.query({ page: 1, pageSize: 1000 })
    ])
    warehouses.value = whs.list
    importWarehouse.value = warehouses.value.find((warehouse) => warehouse.is_default)?.id ?? warehouses.value[0]?.id ?? null
    customers.value = cs.list
    suppliers.value = ss.list
    await Promise.all([loadStatus(), searchProducts('')])
  } catch (e) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
})

async function save(): Promise<void> {
  for (const [i, l] of invLines.entries()) {
    if (l.product_id == null || l.warehouse_id == null || l.qty <= 0 || l.unit_cost < 0) {
      ElMessage.error(`期初库存第 ${i + 1} 行不完整：请选择商品和仓库，数量须大于 0，单价不能为负数`)
      return
    }
  }
  for (const [i, l] of customerLines.entries()) {
    if (l.ref_id == null) {
      ElMessage.error(`客户期初第 ${i + 1} 行未选择客户`)
      return
    }
  }
  for (const [i, l] of supplierLines.entries()) {
    if (l.ref_id == null) {
      ElMessage.error(`供应商期初第 ${i + 1} 行未选择供应商`)
      return
    }
  }
  saving.value = true
  try {
    const payload: OpeningPayload = {
      inventory: invLines.map((l) => ({
        product_id: l.product_id!,
        warehouse_id: l.warehouse_id!,
        batch_no: l.batch_no || undefined,
        qty: l.qty,
        unit_cost: l.unit_cost
      })),
      customers: customerLines.map((l) => ({ customer_id: l.ref_id!, receivable: l.amount })),
      suppliers: supplierLines.map((l) => ({ supplier_id: l.ref_id!, payable: l.amount }))
    }
    await openingApi.save(payload)
    ElMessage.success('期初建账完成')
    await loadStatus()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="opening-view" v-loading="loading">
    <el-card>
      <template #header>
        <span class="card-title">期初建账</span>
      </template>

      <el-result v-if="done" icon="success" title="期初已建账" sub-title="期初数据已锁定，不能再修改" />

      <template v-else>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="期初建账为一次性操作，保存后将锁定，不能再修改"
          style="margin-bottom: 16px"
        />

        <el-divider content-position="left">期初库存</el-divider>
        <el-space v-if="hasPermission('data.import')" wrap style="margin-bottom: 8px">
          <el-select v-model="importWarehouse" aria-label="导入仓库" placeholder="选择导入仓库" style="width: 160px">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id!" />
          </el-select>
          <el-button :loading="importing" :disabled="importWarehouse === null || saving" @click="importInput?.click()">载入库存 CSV</el-button>
          <el-button v-if="hasPermission('data.export')" :loading="exportingTemplate" @click="downloadStockTemplate">下载模板</el-button>
          <input ref="importInput" type="file" accept=".csv,text/csv" hidden @change="importStock" />
          <span>表头顺序为商品编码、数量、成本单价、批次号。</span>
        </el-space>
        <el-table :data="invLines" size="small">
          <el-table-column label="商品" min-width="220">
            <template #default="{ row }">
              <el-select
                v-model="row.product_id"
                filterable
                remote
                :remote-method="searchProducts"
                :loading="productSearching"
                placeholder="输入编码或名称搜索"
                style="width: 100%"
              >
                <el-option v-if="row.product_id && !productOptions.has(row.product_id) && importedProductLabels[row.product_id]"
                  :label="importedProductLabels[row.product_id]" :value="row.product_id" />
                <el-option
                  v-for="p in productOptions.values()"
                  :key="p.id"
                  :label="`${p.code} ${p.name}`"
                  :value="p.id!"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="仓库" width="150">
            <template #default="{ row }">
              <el-select v-model="row.warehouse_id" style="width: 100%">
                <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id!" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="批次" width="130">
            <template #default="{ row }">
              <el-input v-model="row.batch_no" placeholder="可选" />
            </template>
          </el-table-column>
          <el-table-column label="数量" width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.qty" :min="0" :precision="2" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column label="单价" width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.unit_cost" :min="0" :precision="2" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column width="70" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="invLines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button style="margin-top: 8px" @click="addInvLine">添加库存行</el-button>

        <el-divider content-position="left">客户期初应收</el-divider>
        <el-table :data="customerLines" size="small">
          <el-table-column label="客户" min-width="220">
            <template #default="{ row }">
              <el-select v-model="row.ref_id" filterable style="width: 100%">
                <el-option v-for="c in customers" :key="c.id" :label="`${c.code} ${c.name}`" :value="c.id!" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="期初应收" width="180">
            <template #default="{ row }">
              <el-input-number v-model="row.amount" :precision="2" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column width="70" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="customerLines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button style="margin-top: 8px" @click="addCustomerLine">添加客户行</el-button>

        <el-divider content-position="left">供应商期初应付</el-divider>
        <el-table :data="supplierLines" size="small">
          <el-table-column label="供应商" min-width="220">
            <template #default="{ row }">
              <el-select v-model="row.ref_id" filterable style="width: 100%">
                <el-option v-for="s in suppliers" :key="s.id" :label="`${s.code} ${s.name}`" :value="s.id!" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="期初应付" width="180">
            <template #default="{ row }">
              <el-input-number v-model="row.amount" :precision="2" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column width="70" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="supplierLines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button style="margin-top: 8px" @click="addSupplierLine">添加供应商行</el-button>

        <div style="margin-top: 20px">
          <el-button type="primary" :loading="saving" :disabled="importing" @click="save">保存期初</el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.card-title {
  font-weight: 600;
}
</style>
