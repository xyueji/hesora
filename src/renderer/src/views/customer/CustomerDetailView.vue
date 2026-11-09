<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { customerApi, type CustomerDetail } from '../../api/customer'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const detail = ref<CustomerDetail | null>(null)

const DOC_TYPE_LABELS: Record<string, string> = {
  sale: '销售单',
  retail: '零售单',
  sale_return: '销售退货单'
}

function fmt(n: number): string {
  return Number(n).toFixed(2)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    detail.value = await customerApi.detail(Number(route.params.id))
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="customer-detail">
    <el-card v-if="detail" shadow="never">
      <div class="toolbar">
        <h3 class="title">客户详情：{{ detail.customer.name }}</h3>
        <div class="actions">
          <el-button @click="router.back()">返回</el-button>
        </div>
      </div>
      <el-descriptions :column="3" border class="base-info">
        <el-descriptions-item label="编码">{{ detail.customer.code }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ detail.customer.name }}</el-descriptions-item>
        <el-descriptions-item label="联系人">{{ detail.customer.contact || '—' }}</el-descriptions-item>
        <el-descriptions-item label="电话">{{ detail.customer.phone || '—' }}</el-descriptions-item>
        <el-descriptions-item label="地址">{{ detail.customer.address || '—' }}</el-descriptions-item>
        <el-descriptions-item label="价格等级">{{ detail.customer.price_level || '—' }}</el-descriptions-item>
        <el-descriptions-item label="预存款">¥{{ fmt(detail.customer.prepaid ?? 0) }}</el-descriptions-item>
        <el-descriptions-item label="期初应收">¥{{ fmt(detail.customer.opening_receivable) }}</el-descriptions-item>
        <el-descriptions-item label="应收余额">
          <span class="arrears" :class="{ warn: detail.arrears > 0 }">¥{{ fmt(detail.arrears) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.customer.remark || '—' }}</el-descriptions-item>
      </el-descriptions>

      <h4 class="section-title">最近交易（最多 20 笔）</h4>
      <el-table :data="detail.transactions" stripe border>
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="no" label="单号" width="180" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">{{ DOC_TYPE_LABELS[row.type] ?? row.type }}</template>
        </el-table-column>
        <el-table-column label="金额" width="130" align="right">
          <template #default="{ row }">¥{{ fmt(row.total_amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'done'" type="success" size="small">已过账</el-tag>
            <el-tag v-else type="info" size="small">草稿</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  margin: 0;
}
.arrears.warn {
  color: var(--el-color-danger);
  font-weight: 700;
}
.section-title {
  margin: 16px 0 8px;
}
</style>
