<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { transferApi, type TransferDetail } from '../../api/transfer'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import type { DocRow, DocItemRow } from '../../../../shared/types/doc'

const keyword = ref('')
const dateRange = ref<[string, string] | null>(null)
const loading = ref(false)
const list = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const warehouseNames = ref<Record<number, string>>({})
const productNames = ref<Record<number, string>>({})

const detailVisible = ref(false)
const detail = ref<TransferDetail | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await transferApi.query({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    })
    list.value = r.items
    total.value = r.total
    await loadNames(r.items)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function loadNames(rows: DocRow[]): Promise<void> {
  const whIds = [...new Set(rows.flatMap((r) => [r.warehouse_id, r.warehouse_in_id]).filter((v): v is number => v !== null))]
  for (const id of whIds) {
    if (warehouseNames.value[id]) continue
    try {
      const w = await warehouseApi.get(id)
      warehouseNames.value[id] = w?.name ?? `#${id}`
    } catch {
      warehouseNames.value[id] = `#${id}`
    }
  }
  // 商品名按当前页单据逐单补齐（详情弹窗展示用）
  for (const row of rows) {
    try {
      const d = await transferApi.getDetail(row.id)
      const ids = [...new Set(d.items.map((i) => i.product_id))]
      for (const pid of ids) {
        if (productNames.value[pid]) continue
        const p = await productApi.get(pid)
        productNames.value[pid] = p ? `${p.code} ${p.name}` : `#${pid}`
      }
    } catch {
      /* 忽略：弹窗打开时会再次加载 */
    }
  }
}

function search(): void {
  page.value = 1
  void load()
}

async function viewDetail(row: DocRow): Promise<void> {
  try {
    detail.value = await transferApi.getDetail(row.id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function productName(item: DocItemRow): string {
  return productNames.value[item.product_id] ?? `#${item.product_id}`
}

function whName(id: number | null): string {
  return id === null ? '—' : (warehouseNames.value[id] ?? `#${id}`)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="transfer-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">调拨单</h3>
        <div class="actions">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
            @change="search"
          />
          <el-input
            v-model="keyword"
            placeholder="搜索单号"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe class="table">
        <el-table-column prop="no" label="单号" width="180" />
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column label="调出仓" min-width="120">
          <template #default="{ row }">{{ whName(row.warehouse_id) }}</template>
        </el-table-column>
        <el-table-column label="调入仓" min-width="120">
          <template #default="{ row }">{{ whName(row.warehouse_in_id) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />
    </el-card>

    <el-dialog v-model="detailVisible" title="调拨单详情" width="760px">
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="desc">
          <el-descriptions-item label="单号">{{ detail.doc.no }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detail.doc.date }}</el-descriptions-item>
          <el-descriptions-item label="调出仓">{{ whName(detail.doc.warehouse_id) }}</el-descriptions-item>
          <el-descriptions-item label="调入仓">{{ whName(detail.doc.warehouse_in_id) }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detail.doc.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" stripe size="small">
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">{{ productName(row) }}</template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column prop="batch_no" label="批次号" width="100" />
          <el-table-column prop="qty" label="数量" width="90" align="right" />
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.transfer-list .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.transfer-list .title {
  margin: 0;
}
.transfer-list .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.transfer-list .search {
  width: 220px;
}
.transfer-list .pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
