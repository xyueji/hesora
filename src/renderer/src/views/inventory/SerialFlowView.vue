<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { serialApi } from '../../api/serial'
import type { SerialFlowRow } from '../../../../shared/types/serial'

const sn = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<SerialFlowRow[]>([])
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await serialApi.flows({
      sn: sn.value || undefined,
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
  sn.value = ''
  page.value = 1
  void load()
}
</script>

<template>
  <div class="page">
    <h2>序列号流水</h2>
    <el-form inline @submit.prevent>
      <el-form-item label="序列号">
        <el-input v-model="sn" placeholder="序列号模糊匹配" clearable style="width: 220px" @keyup.enter="search" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="items" v-loading="loading" border>
      <el-table-column prop="sn" label="序列号" min-width="150" />
      <el-table-column prop="product_code" label="商品编码" width="110" />
      <el-table-column prop="product_name" label="商品名称" min-width="140" />
      <el-table-column label="方向" width="80">
        <template #default="{ row }">
          <el-tag :type="row.direction === 'in' ? 'success' : 'warning'">
            {{ row.direction === 'in' ? '入库' : '出库' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="qty" label="数量" width="70" />
      <el-table-column prop="doc_no" label="关联单号" width="150" />
      <el-table-column prop="created_at" label="时间" width="160" />
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
