<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { paymentApi } from '../../api/payment'
import type { DocRow } from '../../../../shared/types/doc'
import type { FundFlowRow } from '../../../../shared/types/payment'

type TabType = 'receipt' | 'payment'

const activeTab = ref<TabType>('receipt')
const keyword = ref('')
const dateRange = ref<[string, string] | null>(null)
const loading = ref(false)
const list = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const detailVisible = ref(false)
const detailDoc = ref<DocRow | null>(null)
const detailFlow = ref<FundFlowRow | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const q = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    }
    const r =
      activeTab.value === 'receipt' ? await paymentApi.queryReceipt(q) : await paymentApi.queryPayment(q)
    list.value = r.items
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

function onTabChange(): void {
  page.value = 1
  void load()
}

function fmt(n: number): string {
  return n.toFixed(2)
}

async function viewDetail(row: DocRow): Promise<void> {
  try {
    const d =
      row.type === 'receipt'
        ? await paymentApi.getReceiptDetail(row.id)
        : await paymentApi.getPaymentDetail(row.id)
    detailDoc.value = d.doc
    detailFlow.value = d.flow
    detailVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="payment-list">
    <el-card shadow="never">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="收款单" name="receipt" />
        <el-tab-pane label="付款单" name="payment" />
      </el-tabs>

      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="单据编号"
          clearable
          style="width: 200px"
          @keyup.enter="search"
          @clear="search"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
          @change="search"
        />
        <el-button type="primary" @click="search">查询</el-button>
      </div>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="no" label="单据编号" width="170" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.type === 'receipt' ? 'success' : 'warning'">
              {{ row.type === 'receipt' ? '收款' : '付款' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column label="金额" width="130" align="right">
          <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
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

    <el-dialog v-model="detailVisible" title="单据详情" width="520px">
      <el-descriptions v-if="detailDoc" :column="2" border>
        <el-descriptions-item label="单据编号">{{ detailDoc.no }}</el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ detailDoc.type === 'receipt' ? '收款单' : '付款单' }}
        </el-descriptions-item>
        <el-descriptions-item label="日期">{{ detailDoc.date }}</el-descriptions-item>
        <el-descriptions-item label="金额">{{ fmt(detailDoc.total_amount) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detailDoc.remark ?? '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-descriptions v-if="detailFlow" :column="2" border class="flow">
        <el-descriptions-item label="资金方向">
          <el-tag :type="detailFlow.direction === 'in' ? 'success' : 'warning'">
            {{ detailFlow.direction === 'in' ? '流入' : '流出' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="流水金额">{{ fmt(detailFlow.amount) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.flow {
  margin-top: 12px;
}
</style>
