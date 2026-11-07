<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fundLedgerApi } from '../../api/fund-ledger'
import type { FundLedgerAccount, FundLedgerEntry } from '../../../../shared/types/fund-ledger'
import { DOC_TYPE_LABELS, type DocType } from '../../../../shared/types/doc'

const accounts = ref<FundLedgerAccount[]>([])
const entries = ref<FundLedgerEntry[]>([])
const selected = ref<number>()
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const form = reactive({ from: 0, to: 0, date: '', amount: 0, remark: '' })
const enabled = computed(() => accounts.value.filter((a) => !a.disabled))
const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const typeLabel = (type: string) => type === 'account_transfer' ? '账户转账' : DOC_TYPE_LABELS[type as DocType] ?? type

function notify(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : String(error))
}

async function loadEntries() {
  if (!selected.value) return
  try {
    const result = await fundLedgerApi.entries(selected.value, page.value)
    entries.value = result.list
    total.value = result.total
  } catch (error) { notify(error) }
}

async function load() {
  loading.value = true
  try {
    accounts.value = await fundLedgerApi.accounts()
    selected.value ??= accounts.value[0]?.id
    await loadEntries()
  } catch (error) { notify(error) } finally { loading.value = false }
}

function openTransfer() {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const from = enabled.value.find((a) => a.id === selected.value)?.id ?? enabled.value[0]?.id ?? 0
  Object.assign(form, { from, to: enabled.value.find((a) => a.id !== from)?.id ?? 0, date, amount: 0, remark: '' })
  dialog.value = true
}

async function submit() {
  if (saving.value) return
  if (!form.from || !form.to || form.from === form.to || !(form.amount > 0)) {
    ElMessage.warning('请选择两个不同账户并录入转账金额')
    return
  }
  saving.value = true
  try {
    const from = enabled.value.find((a) => a.id === form.from)?.name
    const to = enabled.value.find((a) => a.id === form.to)?.name
    await ElMessageBox.confirm(`从「${from}」转 ¥${money(form.amount)} 至「${to}」？`, '确认转账')
    const transfer = await fundLedgerApi.transfer({ ...form })
    ElMessage.success(`转账已记账：${transfer.no}`)
    dialog.value = false
    selected.value = form.from
    page.value = 1
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') notify(error)
  } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div class="ledger-page" v-loading="loading">
    <el-card shadow="never">
      <template #header><div class="ledger-heading"><div><h2>资金余额与转账</h2><p>账户余额由期初余额和已记录的资金流水汇总。</p></div><el-button type="primary" :disabled="enabled.length < 2" @click="openTransfer">新增转账</el-button></div></template>
      <el-table :data="accounts" highlight-current-row empty-text="请先在资金账户中建立账户" @row-click="selected = $event.id; page = 1; loadEntries()">
        <el-table-column prop="name" label="资金账户" min-width="180" />
        <el-table-column label="期初余额" align="right" min-width="120"><template #default="{ row }">{{ money(row.opening_balance) }}</template></el-table-column>
        <el-table-column label="账面余额" align="right" min-width="120"><template #default="{ row }">{{ money(row.balance) }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }">{{ row.disabled ? '停用' : '启用' }}</template></el-table-column>
      </el-table>
    </el-card>
    <el-card shadow="never">
      <template #header>余额明细</template>
      <el-select v-model="selected" placeholder="选择资金账户" style="width: 190px; margin-bottom: 14px" @change="page = 1; loadEntries()">
        <el-option v-for="a in accounts" :key="a.id" :label="a.name" :value="a.id" />
      </el-select>
      <el-table :data="entries" empty-text="该账户暂无资金流水">
        <el-table-column prop="date" label="日期" width="105" />
        <el-table-column prop="no" label="单据编号" min-width="138" />
        <el-table-column label="业务类型" min-width="100"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
        <el-table-column label="变动金额" min-width="105" align="right"><template #default="{ row }">{{ row.direction === 'in' ? '+' : '−' }}{{ money(row.amount) }}</template></el-table-column>
        <el-table-column label="变动后余额" min-width="110" align="right"><template #default="{ row }">{{ money(row.balance) }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip />
      </el-table>
      <el-pagination v-model:current-page="page" :page-size="30" :total="total" layout="total, prev, pager, next" @current-change="loadEntries" />
    </el-card>
    <el-dialog v-model="dialog" title="新增资金转账" width="480px" :close-on-click-modal="false">
      <el-form label-width="90px" :disabled="saving">
        <el-form-item label="转出账户"><el-select v-model="form.from"><el-option v-for="a in enabled" :key="a.id" :label="a.name" :value="a.id" /></el-select></el-form-item>
        <el-form-item label="转入账户"><el-select v-model="form.to"><el-option v-for="a in enabled" :key="a.id" :label="a.name" :value="a.id" :disabled="a.id === form.from" /></el-select></el-form-item>
        <el-form-item label="业务日期"><el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="转账金额"><el-input-number v-model="form.amount" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" maxlength="200" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="dialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="submit">确认记账</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ledger-page { display: grid; gap: 16px; padding: 16px; }
.ledger-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0; font-size: 20px; }
p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 13px; font-weight: 400; }
</style>
