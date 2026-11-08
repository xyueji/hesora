<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { settingApi } from '../../api/setting'
import { call } from '../../api/call'
import type { AuditEntry } from '../../../../main/services/audit/audit.service'

const loading = ref(false)
const saving = ref(false)
const auditRows = ref<AuditEntry[]>([])
const auditLoading = ref(false)
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = 20
const auditKeyword = ref('')
const auditAction = ref('')
const auditRange = ref<[string, string] | null>(null)
const auditLabels: Record<string, string> = {
  restore: '恢复备份', 'product.price': '修改价格', 'price.update': '修改价格', 'data.export': '导出数据',
  'doc.delete': '删除单据', 'doc.reverse': '红冲/反审核', 'doc.void': '作废单据',
  'user.create': '创建操作员', 'user.update': '修改操作员', 'user.remove': '移除操作员',
  'role.create': '创建角色', 'role.update': '修改角色', 'role.remove': '移除角色',
  'customerPrice:remove': '删除客户价', 'setting:remove': '删除设置', 'category:remove': '删除分类',
  'formula:remove': '删除配方'
}
const auditActionOptions = Object.keys(auditLabels)

async function loadAudit() {
  auditLoading.value = true
  try {
    const res = await call<{ total: number; list: AuditEntry[] }>('audit:query', {
      page: auditPage.value,
      pageSize: auditPageSize,
      keyword: auditKeyword.value || undefined,
      action: auditAction.value || undefined,
      from: auditRange.value?.[0],
      to: auditRange.value?.[1]
    })
    auditRows.value = res.list
    auditTotal.value = res.total
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    auditLoading.value = false
  }
}

function searchAudit() {
  auditPage.value = 1
  loadAudit()
}
const form = reactive({
  'shop.name': '',
  'shop.phone': '',
  'shop.address': '',
  'shop.receipt_header': '',
  'print.receipt_width': '58',
  'print.receipt_footer': '谢谢惠顾',
  'guide.show': true
})

onMounted(async () => {
  loading.value = true
  try {
    const all = await settingApi.getAll()
    for (const key of Object.keys(form) as (keyof typeof form)[]) {
      const v = all[key]
      if (key === 'guide.show') {
        form['guide.show'] = v !== '0'
      } else if (v !== undefined) {
        form[key] = v
      }
    }
  } catch (e) {
    ElMessage.error((e as Error).message || '加载设置失败')
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    await settingApi.set('shop.name', form['shop.name'])
    await settingApi.set('shop.phone', form['shop.phone'])
    await settingApi.set('shop.address', form['shop.address'])
    await settingApi.set('shop.receipt_header', form['shop.receipt_header'])
    await settingApi.set('print.receipt_width', form['print.receipt_width'])
    await settingApi.set('print.receipt_footer', form['print.receipt_footer'])
    await settingApi.set('guide.show', form['guide.show'] ? '1' : '0')
    ElMessage.success('设置已保存')
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="setting-view" v-loading="loading">
    <el-card>
      <template #header>
        <span class="card-title">系统设置</span>
      </template>
      <el-form label-width="120px" style="max-width: 560px">
        <el-divider content-position="left">店铺信息</el-divider>
        <el-form-item label="店铺名称">
          <el-input v-model="form['shop.name']" placeholder="请输入店铺名称" />
        </el-form-item>
        <el-form-item label="店铺电话">
          <el-input v-model="form['shop.phone']" placeholder="请输入店铺电话" />
        </el-form-item>
        <el-form-item label="店铺地址">
          <el-input v-model="form['shop.address']" placeholder="请输入店铺地址" />
        </el-form-item>
        <el-form-item label="单据小票抬头">
          <el-input v-model="form['shop.receipt_header']" placeholder="打印在小票顶部的抬头文字" />
        </el-form-item>
          <el-form-item label="小票宽度">
            <el-select v-model="form['print.receipt_width']">
              <el-option label="58 mm" value="58" />
              <el-option label="80 mm" value="80" />
            </el-select>
          </el-form-item>
          <el-form-item label="小票底部文字">
            <el-input v-model="form['print.receipt_footer']" maxlength="100" />
          </el-form-item>
        <el-divider content-position="left">显示开关</el-divider>
        <el-form-item label="新手引导">
          <el-checkbox v-model="form['guide.show']">是否显示新手引导</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card style="margin-top: 16px">
      <template #header>
        <span class="card-title">操作记录</span>
        <el-button text :loading="auditLoading" @click="searchAudit">查询</el-button>
      </template>
      <div class="audit-filter">
        <el-input
          v-model="auditKeyword"
          placeholder="按对象/操作员搜索"
          clearable
          style="width: 200px"
          @keyup.enter="searchAudit"
          @clear="searchAudit"
        />
        <el-select v-model="auditAction" placeholder="全部操作" clearable style="width: 160px" @change="searchAudit">
          <el-option v-for="a in auditActionOptions" :key="a" :label="auditLabels[a]" :value="a" />
        </el-select>
        <el-date-picker
          v-model="auditRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 260px"
          @change="searchAudit"
        />
      </div>
      <el-table :data="auditRows" size="small" empty-text="暂无操作记录" v-loading="auditLoading">
        <el-table-column label="时间" min-width="155">
          <template #default="{ row }">{{ new Date(row.created_at).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="operator" label="操作员" min-width="95" />
        <el-table-column label="操作" min-width="110">
          <template #default="{ row }">{{ auditLabels[row.action] ?? row.action }}</template>
        </el-table-column>
        <el-table-column prop="detail" label="对象" show-overflow-tooltip min-width="120" />
        <el-table-column prop="before_value" label="变更前" show-overflow-tooltip min-width="100" />
        <el-table-column prop="after_value" label="变更后" show-overflow-tooltip min-width="100" />
      </el-table>
      <el-pagination
        class="mt"
        layout="total, prev, pager, next"
        :total="auditTotal"
        :page-size="auditPageSize"
        :current-page="auditPage"
        @current-change="(p: number) => { auditPage = p; loadAudit() }"
      />
    </el-card>
  </div>
</template>

<style scoped>
.setting-view {
  padding: 24px;
}
.card-title {
  font-weight: 600;
}
.audit-filter {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
</style>
