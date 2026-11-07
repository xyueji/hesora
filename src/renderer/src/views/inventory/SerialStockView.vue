<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { serialApi } from '../../api/serial'
import { warehouseApi } from '../../api/warehouse'
import type { SerialStockRow, SerialStatus } from '../../../../shared/types/serial'

const keyword = ref('')
const warehouseId = ref<number | undefined>(undefined)
const status = ref<SerialStatus | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<SerialStockRow[]>([])
const warehouses = ref<{ id: number; name: string }[]>([])
const loading = ref(false)

const STATUS_LABELS: Record<SerialStatus, string> = {
  in_stock: '在库',
  out: '已出库'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await serialApi.stock({
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value,
      status: status.value,
      page: page.value,
      pageSize: pageSize.value
    })
    items.value = r.items
    total.value = r.total
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  warehouseId.value = undefined
  status.value = undefined
  page.value = 1
  void load()
}

onMounted(() => {
  void warehouseApi
    .query({ page: 1, pageSize: 100 })
    .then((r) => {
      warehouses.value = r.list.map((w) => ({ id: w.id as number, name: w.name }))
    })
    .catch(() => {
      warehouses.value = []
    })
  void load()
})
</script>

<template>
  <div class="page">
    <h2>序列号台账</h2>
    <el-form inline @submit.prevent>
      <el-form-item label="关键字">
        <el-input v-model="keyword" placeholder="序列号/商品编码/名称" clearable style="width: 200px" @keyup.enter="search" />
      </el-form-item>
      <el-form-item label="仓库">
        <el-select v-model="warehouseId" clearable placeholder="全部仓库" style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="status" clearable placeholder="全部" style="width: 120px">
          <el-option label="在库" value="in_stock" />
          <el-option label="已出库" value="out" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="items" v-loading="loading" border>
      <el-table-column prop="sn" label="序列号" min-width="140" />
      <el-table-column prop="product_code" label="商品编码" width="110" />
      <el-table-column prop="product_name" label="商品名称" min-width="140" />
      <el-table-column prop="warehouse_name" label="仓库" width="100" />
      <el-table-column prop="batch_no" label="批次" width="110" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'in_stock' ? 'success' : 'info'">
            {{ STATUS_LABELS[row.status as SerialStatus] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="in_date" label="入库日期" width="110" />
      <el-table-column prop="in_source_no" label="入库单号" width="140" />
      <el-table-column prop="out_date" label="出库日期" width="110" />
      <el-table-column prop="out_source_no" label="出库单号" width="140" />
      <el-table-column prop="remark" label="备注" min-width="100" />
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      layout="total, prev, pager, next, sizes"
      :total="total"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[20, 50, 100]"
      @current-change="load"
      @size-change="search"
    />
  </div>
</template>

<style scoped>
.page {
  padding: 4px;
}
</style>
