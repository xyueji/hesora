<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { internalUseApi, type InternalUseDetail } from '../../api/internal-use'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { docApi } from '../../api/doc'
import type { DocRow, DocItemRow } from '../../../../shared/types/doc'
import { hasPermission } from '../../stores/auth'

const router = useRouter()

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
const detail = ref<InternalUseDetail | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await internalUseApi.query({
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
  const whIds = [
    ...new Set(rows.map((r) => r.warehouse_id).filter((v): v is number => v !== null))
  ]
  for (const id of whIds) {
    if (warehouseNames.value[id]) continue
    try {
      const w = await warehouseApi.get(id)
      warehouseNames.value[id] = w?.name ?? `#${id}`
    } catch {
      warehouseNames.value[id] = `#${id}`
    }
  }
  for (const row of rows) {
    try {
      const d = await internalUseApi.getDetail(row.id)
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
    detail.value = await internalUseApi.getDetail(row.id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

/** P3：整单红冲（负向镜像单，库存自动回退） */
async function reverseDoc(row: DocRow): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定红冲内部领用单 ${row.no} 吗？将生成负向镜像单并回退库存。`,
      '红冲确认',
      { type: 'warning', confirmButtonText: '确定红冲', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    const doc = await docApi.reverse(row.id)
    ElMessage.success(`红冲成功：${doc.no}`)
    void load()
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
  <div class="internal-use-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">内部领用单</h3>
        <div class="actions">
          <el-button type="primary" @click="router.push('/inventory/internal-use/new')">新建领用</el-button>
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
        <el-table-column label="领用仓" min-width="120">
          <template #default="{ row }">{{ whName(row.warehouse_id) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
            <el-button v-if="hasPermission('inventory.adjust')" link type="danger" @click="reverseDoc(row)">红冲</el-button>
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

    <el-dialog v-model="detailVisible" title="内部领用单详情" width="760px">
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="desc">
          <el-descriptions-item label="单号">{{ detail.doc.no }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detail.doc.date }}</el-descriptions-item>
          <el-descriptions-item label="领用仓">{{ whName(detail.doc.warehouse_id) }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="3">{{ detail.doc.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.items" stripe size="small">
          <el-table-column label="商品" min-width="160">
            <template #default="{ row }">{{ productName(row) }}</template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column prop="batch_no" label="批次号" width="100" />
          <el-table-column prop="qty" label="数量" width="90" align="right" />
          <el-table-column prop="remark" label="领用人/用途" min-width="140" show-overflow-tooltip />
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.internal-use-list .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.internal-use-list .title {
  margin: 0;
}
.internal-use-list .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.internal-use-list .search {
  width: 220px;
}
.internal-use-list .pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
