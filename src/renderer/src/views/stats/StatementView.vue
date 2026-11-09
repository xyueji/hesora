<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { statementApi } from '../../api/stats'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import { DOC_TYPE_LABELS } from '../../../../shared/types/doc'
import type { Customer } from '../../../../shared/types/customer'
import type { Supplier } from '../../../../shared/types/supplier'
import type { StatementResult } from '../../../../shared/types/stats'
import type { PageResult } from '../../../../shared/types/common'

// P1 功能 #1 客商对账单：期初余额 + 逐笔往来明细（单据/收付款/退货冲减）+ 期末余额。
// 应收口径：销售/零售增，收款/销售退货减；应付对称。
const partnerType = ref<'customer' | 'supplier'>('customer')
const dateFrom = ref('')
const dateTo = ref('')
const partnerId = ref<number | null>(null)
const partnerOptions = ref<Array<{ id: number; name: string; code: string }>>([])
const result = ref<StatementResult | null>(null)
const loading = ref(false)

async function searchPartners(keyword: string): Promise<void> {
  try {
    const kw = keyword.trim()
    if (partnerType.value === 'customer') {
      const page: PageResult<Customer> = await customerApi.query({ page: 1, pageSize: 20, keyword: kw || undefined })
      partnerOptions.value = page.list.map((c) => ({ id: c.id!, name: c.name, code: c.code }))
    } else {
      const page: PageResult<Supplier> = await supplierApi.query({ page: 1, pageSize: 20, keyword: kw || undefined })
      partnerOptions.value = page.list.map((s) => ({ id: s.id!, name: s.name, code: s.code }))
    }
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function onTypeChange(): void {
  partnerId.value = null
  partnerOptions.value = []
  result.value = null
}

async function load(): Promise<void> {
  if (partnerId.value == null) {
    ElMessage.warning('请先选择客商')
    return
  }
  loading.value = true
  try {
    result.value = await statementApi.statement({
      partner_id: partnerId.value,
      partner_type: partnerType.value,
      date_from: dateFrom.value || undefined,
      date_to: dateTo.value || undefined
    })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function typeLabel(type: string): string {
  return (DOC_TYPE_LABELS as Record<string, string>)[type] ?? type
}

function amountClass(row: { direction: string }): string {
  return row.direction === 'increase' ? 'increase' : 'decrease'
}

onMounted(() => {
  void searchPartners('')
})
</script>

<template>
  <div class="statement-view">
    <div class="toolbar">
      <el-select v-model="partnerType" style="width: 120px" @change="onTypeChange">
        <el-option label="客户（应收）" value="customer" />
        <el-option label="供应商（应付）" value="supplier" />
      </el-select>
      <el-select
        v-model="partnerId"
        filterable
        remote
        clearable
        :remote-method="searchPartners"
        placeholder="搜索客商（名称/编码）"
        style="width: 240px"
      >
        <el-option v-for="p in partnerOptions" :key="p.id" :label="`${p.name}（${p.code}）`" :value="p.id" />
      </el-select>
      <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="起始日期" style="width: 150px" />
      <span class="sep">至</span>
      <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="截止日期" style="width: 150px" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>

    <template v-if="result">
      <el-card shadow="never" class="summary-card">
        <div class="summary">
          <span>客商：<b>{{ result.partner_name }}</b></span>
          <span>期初余额：<b class="balance">¥{{ result.opening_balance.toFixed(2) }}</b></span>
          <span>期末余额：<b class="balance">¥{{ result.closing_balance.toFixed(2) }}</b></span>
        </div>
      </el-card>

      <el-card shadow="never">
        <el-table :data="result.lines" v-loading="loading" stripe border>
          <el-table-column prop="date" label="日期" width="110" />
          <el-table-column prop="no" label="单号" min-width="150" />
          <el-table-column label="类型" width="110">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column label="金额" align="right" width="120">
            <template #default="{ row }">
              <span :class="amountClass(row)">{{ row.direction === 'increase' ? '' : '−' }}{{ row.amount.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="已核销" align="right" width="110">
            <template #default="{ row }">{{ row.allocated.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="余额" align="right" width="130">
            <template #default="{ row }"><span class="balance">{{ row.balance.toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.sep {
  color: var(--el-text-color-secondary);
}
.summary-card {
  margin-bottom: 12px;
}
.summary {
  display: flex;
  gap: 32px;
  font-size: 14px;
}
.balance {
  color: var(--el-color-danger);
}
.increase {
  color: var(--el-color-danger);
}
.decrease {
  color: var(--el-color-success);
}
</style>
