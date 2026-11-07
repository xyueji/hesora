<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockReportApi } from '../../api/stock-report'
import { productApi } from '../../api/product'
import type { AdjustPriceItem } from '../../../../shared/types/stock-report'

interface DraftRow {
  product_id: number | null
  retail_price: number | null
  trade_price: number | null
  purchase_price: number | null
}

interface ProductOption {
  id: number
  name: string
}

const drafts = ref<DraftRow[]>([])
const loading = ref(false)
const productOptions = ref<ProductOption[]>([])

function emptyDraft(): DraftRow {
  return { product_id: null, retail_price: null, trade_price: null, purchase_price: null }
}

async function searchProduct(keyword: string, cb: (list: ProductOption[]) => void): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 20, keyword })
    cb(r.list.map((p) => ({ id: p.id as number, name: `${p.code} ${p.name}` })))
  } catch {
    cb([])
  }
}

function remoteSearch(keyword: string, cb: (list: ProductOption[]) => void): void {
  void searchProduct(keyword, (list) => {
    productOptions.value = list
    cb(list)
  })
}

async function onProductPick(row: DraftRow): Promise<void> {
  if (!row.product_id) return
  try {
    const p = await productApi.get(row.product_id)
    if (!p) return
    row.retail_price = p.retail_price
    row.trade_price = p.trade_price
    row.purchase_price = p.purchase_price
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function removeRow(index: number): void {
  drafts.value.splice(index, 1)
  if (drafts.value.length === 0) drafts.value.push(emptyDraft())
}

async function submit(): Promise<void> {
  const items: AdjustPriceItem[] = []
  for (const row of drafts.value) {
    if (!row.product_id) continue
    items.push({
      product_id: row.product_id,
      retail_price: row.retail_price ?? undefined,
      trade_price: row.trade_price ?? undefined,
      purchase_price: row.purchase_price ?? undefined
    })
  }
  if (items.length === 0) {
    ElMessage.warning('请先选择商品并填写新价格')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认调整 ${items.length} 个商品的价格？调整将记入调价日志`,
      '确认调价',
      { type: 'warning' }
    )
  } catch {
    return
  }
  loading.value = true
  try {
    const r = await stockReportApi.adjustPrices(items)
    ElMessage.success(`已调整 ${r.updated} 个商品价格`)
    drafts.value = [emptyDraft()]
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  drafts.value = [emptyDraft()]
})
</script>

<template>
  <div class="page">
    <h2>调整售价</h2>
    <el-alert
      type="info"
      :closable="false"
      title="支持同时调整 零售价 / 批发价 / 进货价；留空表示不调整该价格"
    />

    <el-table :data="drafts" v-loading="loading" style="margin-top: 12px">
      <el-table-column label="商品" min-width="220">
        <template #default="{ row }">
          <el-select
            v-model="row.product_id"
            filterable
            remote
            :remote-method="remoteSearch"
            :loading="loading"
            placeholder="输入编码/名称搜索"
            style="width: 100%"
            @change="onProductPick(row)"
          >
            <el-option v-for="o in productOptions" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="零售价" width="160">
        <template #default="{ row }">
          <el-input-number v-model="row.retail_price" :min="0" :precision="2" :controls="false" />
        </template>
      </el-table-column>
      <el-table-column label="批发价" width="160">
        <template #default="{ row }">
          <el-input-number v-model="row.trade_price" :min="0" :precision="2" :controls="false" />
        </template>
      </el-table-column>
      <el-table-column label="进货价" width="160">
        <template #default="{ row }">
          <el-input-number v-model="row.purchase_price" :min="0" :precision="2" :controls="false" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeRow($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="actions">
      <el-button @click="drafts.push(emptyDraft())">添加一行</el-button>
      <el-button type="primary" :loading="loading" @click="submit">提交调价</el-button>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 4px;
}
.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
