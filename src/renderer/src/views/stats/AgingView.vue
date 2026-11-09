<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { statementApi } from '../../api/stats'
import type { PartnerAgingResult, PartnerAgingRow } from '../../../../shared/types/stats'

// P1 功能 #1 账龄分析：按客商未核销单据日期分桶（0-30/31-60/61-90/90+，相对截至日期），
// 期初余额归 90+ 档；余额红色显示。催款与坏账风险判断。
const loading = ref(false)
const result = ref<PartnerAgingResult | null>(null)
const asOf = ref(new Date().toISOString().slice(0, 10))
const partnerType = ref<'customer' | 'supplier'>('customer')

const rows = computed<PartnerAgingRow[]>(() => result.value?.rows ?? [])
const total = computed<PartnerAgingRow | null>(() => result.value?.total ?? null)

function fmt(n: number): string {
  return n.toFixed(2)
}

function aged(v: number): string {
  return v > 0 ? 'aged' : ''
}

async function load(): Promise<void> {
  loading.value = true
  try {
    result.value = await statementApi.aging({ partner_type: partnerType.value, as_of: asOf.value })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function summary(): Array<string | number> {
  const t = total.value
  return t ? ['合计', '', fmt(t.balance), fmt(t.bucket_0_30), fmt(t.bucket_31_60), fmt(t.bucket_61_90), fmt(t.bucket_90p)] : []
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="aging-view">
    <div class="toolbar">
      <el-select v-model="partnerType" style="width: 140px" @change="load">
        <el-option label="客户应收账龄" value="customer" />
        <el-option label="供应商应付账龄" value="supplier" />
      </el-select>
      <span class="label">截至日期</span>
      <el-date-picker v-model="asOf" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 150px" />
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" v-loading="loading" stripe show-summary :summary-method="summary">
        <el-table-column prop="partner_name" label="客商" min-width="140" />
        <el-table-column label="余额" align="right" width="120">
          <template #default="{ row }">
            <span class="balance">{{ fmt(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="0-30 天" align="right" width="110">
          <template #default="{ row }"><span :class="aged(row.bucket_0_30)">{{ fmt(row.bucket_0_30) }}</span></template>
        </el-table-column>
        <el-table-column label="31-60 天" align="right" width="110">
          <template #default="{ row }"><span :class="aged(row.bucket_31_60)">{{ fmt(row.bucket_31_60) }}</span></template>
        </el-table-column>
        <el-table-column label="61-90 天" align="right" width="110">
          <template #default="{ row }"><span :class="aged(row.bucket_61_90)">{{ fmt(row.bucket_61_90) }}</span></template>
        </el-table-column>
        <el-table-column label="90 天以上" align="right" width="120">
          <template #default="{ row }"><span :class="aged(row.bucket_90p)">{{ fmt(row.bucket_90p) }}</span></template>
        </el-table-column>
        <template #empty>暂无账龄数据</template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.label {
  color: var(--el-text-color-secondary);
}
.balance,
.aged {
  color: var(--el-color-danger);
}
</style>
