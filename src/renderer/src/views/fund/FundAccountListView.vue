<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fundApi } from '../../api/fund'
import { FUND_ACCOUNT_TYPES, type FundAccount } from '../../../../shared/types/fund'

const router = useRouter()

const keyword = ref('')
const loading = ref(false)
const list = ref<FundAccount[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

function typeLabel(t: string): string {
  return FUND_ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await fundApi.query({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      includeDisabled: true
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

async function toggleDisabled(row: FundAccount): Promise<void> {
  try {
    if (row.disabled) await fundApi.enable(row.id!)
    else await fundApi.disable(row.id!)
    ElMessage.success(row.disabled ? '已启用' : '已停用')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

onMounted(load)
</script>

<template>
  <div class="fund-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">资金账户</h3>
        <div class="actions">
          <el-input
            v-model="keyword"
            placeholder="搜索编码 / 名称"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
          <el-button type="primary" @click="router.push('/account/edit')">新增账户</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe class="table">
        <el-table-column prop="code" label="编码" width="130" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column label="期初余额" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.opening_balance) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="!row.disabled" type="success" size="small">启用</el-tag>
            <el-tag v-else type="info" size="small">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/account/edit/${row.id}`)">
              编辑
            </el-button>
            <el-button link :type="row.disabled ? 'success' : 'danger'" @click="toggleDisabled(row)">
              {{ row.disabled ? '启用' : '停用' }}
            </el-button>
          </template>
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
    </el-card>
  </div>
</template>

<style scoped>
.fund-list {
  padding: 16px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title {
  margin: 0;
  font-size: 16px;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.search {
  width: 280px;
}
.table {
  width: 100%;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
