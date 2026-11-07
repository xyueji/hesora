<script setup lang="ts">
import { computed, onActivated, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { printApi } from '../../api/print'
import { paymentApi } from '../../api/payment'
import { fundApi } from '../../api/fund'
import { DOC_TYPE_LABELS } from '../../../../shared/types/doc'
import type { DocRow } from '../../../../shared/types/doc'
import type { PaymentDetail, PaymentType } from '../../../../shared/types/payment'
import type { FundAccount } from '../../../../shared/types/fund'

const activeTab = ref<PaymentType>('receipt')
const route = useRoute()
const cashOnly = computed(() => activeTab.value === 'other_in' || activeTab.value === 'other_out')
const keyword = ref('')
const dateRange = ref<[string, string] | null>(null)
const loading = ref(false)
const list = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const detailVisible = ref(false)
const detailDoc = ref<DocRow | null>(null)
const detailFlows = ref<PaymentDetail['flows']>([])
const detailAllocations = ref<PaymentDetail['allocations']>([])
const accounts = ref<FundAccount[]>([])
const createVisible = ref(false)
const creating = ref(false)
const entry = reactive({ account_id: null as number | null, amount: null as number | null, date: '', remark: '' })

async function openCreate(): Promise<void> {
  try {
    accounts.value = (await fundApi.query({ page: 1, pageSize: 200 })).list
    entry.account_id = null
    entry.amount = null
    entry.date = ''
    entry.remark = ''
    createVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function saveEntry(): Promise<void> {
  if (entry.account_id === null || entry.amount === null || entry.amount <= 0) {
    ElMessage.warning('请选择账户并输入大于零的金额')
    return
  }
  creating.value = true
  try {
    await paymentApi.create(activeTab.value, {
      account_id: entry.account_id,
      amount: entry.amount,
      date: entry.date || undefined,
      remark: entry.remark || undefined
    })
    createVisible.value = false
    ElMessage.success('资金单据已登记')
    search()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    creating.value = false
  }
}

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
    const r = await paymentApi.query(activeTab.value, q)
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
    const d = await paymentApi.getDetail(activeTab.value, row.id)
    detailDoc.value = d.doc
    detailFlows.value = d.flows
    detailAllocations.value = d.allocations
    detailVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

onActivated(() => {
  const requested = route.query.type
  if (requested === 'receipt' || requested === 'payment') activeTab.value = requested
  void load()
})

const printingA4 = ref(false)

async function printA4(): Promise<void> {
  if (!detailDoc?.value) return
  printingA4.value = true
  try {
    const path = await printApi.a4Pdf(detailDoc.value.id)
    ElMessage.success(`已保存：${path}`)
  } catch (e) {
    ElMessage.error(`打印失败：${(e as Error).message}`)
  } finally {
    printingA4.value = false
  }
}
</script>

<template>
  <div class="payment-list">
    <el-card shadow="never">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="收款单" name="receipt" />
        <el-tab-pane label="付款单" name="payment" />
        <el-tab-pane label="其他收入" name="other_in" />
        <el-tab-pane label="其他支出" name="other_out" />
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
        <el-button v-if="cashOnly" type="primary" @click="openCreate">登记{{ DOC_TYPE_LABELS[activeTab] }}</el-button>
      </div>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="no" label="单据编号" width="170" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.type === 'receipt' || row.type === 'other_in' ? 'success' : 'warning'">
              {{ DOC_TYPE_LABELS[row.type as PaymentType] }}
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

    <el-dialog v-model="createVisible" :title="`登记${DOC_TYPE_LABELS[activeTab]}`" width="480px">
      <el-form label-width="88px">
        <el-form-item label="资金账户" required>
          <el-select v-model="entry.account_id" filterable>
            <el-option v-for="a in accounts" :key="a.id" :label="a.name" :value="a.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="entry.amount" :precision="2" :min="0" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="entry.date" type="date" value-format="YYYY-MM-DD" placeholder="默认今天" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="entry.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="saveEntry">登记</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="单据详情" width="min(740px, 94vw)">
      <el-descriptions v-if="detailDoc" :column="2" border>
        <el-descriptions-item label="单据编号">{{ detailDoc.no }}</el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ DOC_TYPE_LABELS[detailDoc.type] }}
        </el-descriptions-item>
        <el-descriptions-item label="日期">{{ detailDoc.date }}</el-descriptions-item>
        <el-descriptions-item label="金额">{{ fmt(detailDoc.total_amount) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detailDoc.remark ?? '—' }}</el-descriptions-item>
      </el-descriptions>
      <h4>资金分录</h4>
      <el-table :data="detailFlows" empty-text="暂无资金流水">
        <el-table-column label="账户" min-width="150"><template #default="{ row }">{{ row.account_name || `#${row.account_id}` }}</template></el-table-column>
        <el-table-column label="方向" width="90"><template #default="{ row }">{{ row.direction === 'in' ? '流入' : '流出' }}</template></el-table-column>
        <el-table-column label="金额" align="right" width="120"><template #default="{ row }">{{ fmt(row.amount) }}</template></el-table-column>
      </el-table>
      <template v-if="detailAllocations.length">
        <h4>核销明细</h4>
        <el-table :data="detailAllocations">
          <el-table-column prop="no" label="来源单号" min-width="160" />
          <el-table-column label="核销金额" align="right" width="120"><template #default="{ row }">{{ fmt(row.amount) }}</template></el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button v-if="!cashOnly" :loading="printingA4" @click="printA4">打印 (A4)</el-button>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
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
</style>
