<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { inventoryApi } from '../../api/inventory'
import { warehouseApi } from '../../api/warehouse'
import type { StockItem } from '../../../../shared/types/inventory'
import type { Warehouse } from '../../../../shared/types/warehouse'

const keyword = ref('')
const warehouseId = ref<number | undefined>(undefined)
const loading = ref(false)
const items = ref<StockItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const warehouses = ref<Warehouse[]>([])

const sumQty = computed(() => items.value.reduce((s, i) => s + i.qty, 0))
const sumAmount = computed(() => items.value.reduce((s, i) => s + i.amount, 0))

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await inventoryApi.queryStock({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value
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
  page.value = 1
  void load()
}

onMounted(async () => {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouses.value = r.list
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
  await load()
})
</script>

<template>
  <div class="stock-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">库存统计</h3>
        <div class="filters">
          <el-input
            v-model="keyword"
            placeholder="商品编码 / 名称"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-select
            v-model="warehouseId"
            placeholder="全部仓库"
            clearable
            class="wh-select"
            @change="search"
          >
            <el-option
              v-for="w in warehouses"
              :key="w.id"
              :label="w.name"
              :value="w.id!"
            />
          </el-select>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>

      <el-table :data="items" v-loading="loading" border show-summary :summary-method="() => ['', '合计', '', '', '', '', '', sumQty, '', sumAmount]">
        <el-table-column prop="product_code" label="商品编码" min-width="110" />
        <el-table-column prop="product_name" label="商品名称" min-width="140" />
        <el-table-column prop="spec" label="规格" min-width="120" />
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="warehouse_name" label="仓库" min-width="100" />
        <el-table-column prop="batch_no" label="批次" min-width="100" />
        <el-table-column prop="qty" label="库存数量" align="right" width="100" />
        <el-table-column prop="moving_cost" label="成本单价" align="right" width="100" />
        <el-table-column prop="amount" label="库存金额" align="right" width="110" />
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, sizes"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}
.title {
  margin: 0;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search {
  width: 220px;
}
.wh-select {
  width: 160px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
