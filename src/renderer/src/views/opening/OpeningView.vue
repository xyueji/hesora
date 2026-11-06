<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { openingApi } from '../../api/opening'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import type { Product } from '../../../shared/types/product'
import type { Warehouse } from '../../../shared/types/warehouse'
import type { Customer } from '../../../shared/types/customer'
import type { Supplier } from '../../../shared/types/supplier'
import type { OpeningPayload } from '../../../shared/types/opening'

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
const productSearching = ref(false)

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

function productLabel(id: number | null): string {
  const p = id != null ? productOptions.value.get(id) : undefined
  return p ? `${p.code} ${p.name}` : ''
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
    if (l.product_id == null || l.warehouse_id == null || l.qty <= 0 || l.unit_cost <= 0) {
      ElMessage.error(`期初库存第 ${i + 1} 行不完整：需选择商品和仓库，数量、单价须大于 0`)
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
          <el-button type="primary" :loading="saving" @click="save">保存期初</el-button>
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
