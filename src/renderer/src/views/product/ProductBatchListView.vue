<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { hasPermission } from '../../stores/auth'
import type { BatchStatus, ProductBatch } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

const keyword = ref('')
const productId = ref<number | null>(null)
const warehouseId = ref<number | null>(null)
const onlyExpiring = ref(false)
const onlyExpired = ref(false)
const list = ref<ProductBatch[]>([])
const warehouses = ref<Warehouse[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await productApi.listBatches({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      product_id: productId.value ?? undefined,
      warehouse_id: warehouseId.value ?? undefined,
      only_expiring: onlyExpiring.value || undefined,
      only_expired: onlyExpired.value || undefined
    })
    list.value = r.list
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

function statusType(status: BatchStatus): 'success' | 'warning' | 'danger' {
  if (status === '已过期') return 'danger'
  if (status === '临期') return 'warning'
  return 'success'
}

function remainingText(row: ProductBatch): string {
  if (row.remaining_days === null || row.remaining_days === undefined) return '—'
  return row.remaining_days < 0 ? `已过期 ${Math.abs(row.remaining_days)} 天` : `剩 ${row.remaining_days} 天`
}

onMounted(async () => {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouses.value = r.list
  } catch {
    /* 仓库列表加载失败不阻塞批次查询 */
  }
  await load()
})
</script>

<template>
  <div class="batch-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">批次效期</h3>
        <div class="actions">
          <el-input
            v-model="keyword"
            placeholder="搜索批次号 / 商品 / 仓库"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
          <el-select v-model="warehouseId" clearable placeholder="全部仓库" class="picker" @change="search">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
          <el-checkbox v-model="onlyExpiring" label="仅临期" @change="search" />
          <el-checkbox v-model="onlyExpired" label="仅已过期" @change="search" />
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe class="table" empty-text="暂无批次记录">
        <el-table-column prop="product_code" label="商品编码" width="130" />
        <el-table-column prop="product_name" label="商品名称" min-width="160" />
        <el-table-column prop="batch_no" label="批次号" width="140" />
        <el-table-column prop="warehouse_name" label="仓库" width="120" />
        <el-table-column prop="production_date" label="生产日期" width="120">
          <template #default="{ row }">{{ row.production_date ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="expire_date" label="到期日期" width="120">
          <template #default="{ row }">{{ row.expire_date ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="剩余天数" width="130">
          <template #default="{ row }">{{ remainingText(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140">
          <template #default="{ row }">{{ row.remark ?? '—' }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />

      <p v-if="!hasPermission('product.shelf')" class="tip">
        提示：当前账号没有「保质期与批次效期」权限，仅可查看。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.batch-list {
  padding: 16px;
}
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
  font-size: 16px;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.search {
  width: 280px;
}
.picker {
  width: 160px;
}
.table {
  width: 100%;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.tip {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
