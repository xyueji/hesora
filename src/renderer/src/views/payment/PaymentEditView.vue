<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { paymentApi } from '../../api/payment'
import { fundApi } from '../../api/fund'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import type { FundAccount } from '../../../../shared/types/fund'
import type { Customer } from '../../../../shared/types/customer'
import type { Supplier } from '../../../../shared/types/supplier'
import type { SettlementDocument } from '../../../../shared/types/payment'

const props = defineProps<{ mode: 'receipt' | 'payment' }>()

const router = useRouter()
const route = useRoute()

const isReceipt = computed(() => props.mode === 'receipt')
const title = computed(() => (isReceipt.value ? '收款单' : '付款单'))
const listRoute = '/payment/list'

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  partner_id: null as number | null,
  account_id: null as number | null,
  amount: null as number | null,
  date: today(),
  remark: ''
})

const accountOptions = ref<FundAccount[]>([])
const partnerOptions = ref<Array<Customer | Supplier>>([])
const openBills = ref<SettlementDocument[]>([])
const assigned = ref<Record<number, number | undefined>>({})
const split = ref(false)
const legs = ref<{ account_id?: number; amount?: number }[]>([])
const loadingBills = ref(false)
let billRequest = 0
const totalAllocated = computed(() => Object.values(assigned.value).reduce<number>((sum, value) => sum + Math.round((value ?? 0) * 100), 0) / 100)
const accountTotal = computed(() => legs.value.reduce((sum, row) => sum + Math.round((row.amount ?? 0) * 100), 0) / 100)

async function loadOpenBills(partnerId: number | null, sourceId?: number): Promise<void> {
  const request = ++billRequest
  openBills.value = []
  assigned.value = {}
  loadingBills.value = !!partnerId
  if (!partnerId) return
  try {
    const bills = await paymentApi.openDocuments(props.mode, partnerId)
    if (sourceId && !bills.some((bill) => bill.id === sourceId)) {
      bills.unshift(...await paymentApi.openDocuments(props.mode, partnerId, sourceId))
    }
    if (request === billRequest) openBills.value = bills
  } catch (e) {
    if (request === billRequest) ElMessage.error((e as Error).message)
  } finally {
    if (request === billRequest) loadingBills.value = false
  }
}

async function loadOptions(): Promise<void> {
  try {
    const accs = await fundApi.query({ page: 1, pageSize: 200 })
    accountOptions.value = accs.list
  } catch {
    /* 静默 */
  }
  try {
    if (isReceipt.value) {
      const r = await customerApi.query({ page: 1, pageSize: 200 })
      partnerOptions.value = r.list
    } else {
      const r = await supplierApi.query({ page: 1, pageSize: 200 })
      partnerOptions.value = r.list
    }
  } catch {
    /* 静默 */
  }
}

const saving = ref(false)

async function save(): Promise<void> {
  if (saving.value) return
  if (!split.value && !form.account_id) {
    ElMessage.warning('请选择结算账户')
    return
  }
  if (!form.amount || form.amount <= 0) {
    ElMessage.warning('请输入大于0的金额')
    return
  }
  if (split.value && (legs.value.length < 2 || legs.value.some((row) => !row.account_id || !row.amount || row.amount <= 0) || accountTotal.value !== form.amount)) {
    ElMessage.warning('组合账户各行金额须大于零，合计须等于单据金额')
    return
  }
  if (totalAllocated.value > form.amount) {
    ElMessage.warning('核销合计不能超过单据金额')
    return
  }
  saving.value = true
  try {
    const input = {
      partner_id: form.partner_id ?? undefined,
      account_id: split.value ? undefined : form.account_id ?? undefined,
      accounts: split.value ? legs.value.map((row) => ({ account_id: row.account_id!, amount: row.amount! })) : undefined,
      allocations: openBills.value.flatMap((bill) => {
        const amount = assigned.value[bill.id]
        return amount && amount > 0 ? [{ doc_id: bill.id, amount }] : []
      }),
      amount: form.amount,
      date: form.date || undefined,
      remark: form.remark || undefined
    }
    const doc = isReceipt.value ? await paymentApi.createReceipt(input) : await paymentApi.createPayment(input)
    ElMessage.success(`保存成功：${doc.no}`)
    Object.assign(form, { partner_id: null, account_id: null, amount: null, date: today(), remark: '' })
    split.value = false
    legs.value = []
    await loadOpenBills(null)
    void router.push({ path: listRoute, query: { type: props.mode } })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(loadOptions)

watch(() => [route.path, route.query.partner, route.query.source], async () => {
  if (route.path !== (isReceipt.value ? '/payment/receipt' : '/payment/payment')) return
  const partner = Number(route.query.partner)
  const source = Number(route.query.source)
  if (!Number.isSafeInteger(partner) || partner <= 0 || !Number.isSafeInteger(source) || source <= 0) return
  form.partner_id = partner
  await loadOpenBills(partner, source)
  if (form.partner_id !== partner || Number(route.query.source) !== source) return
  const bill = openBills.value.find((item) => item.id === source)
  if (!bill) {
    ElMessage.warning('该单据没有可核销余额')
    return
  }
  assigned.value[bill.id] = bill.remaining
  form.amount = bill.remaining
}, { immediate: true })

watch(split, (active) => {
  if (active && legs.value.length === 0) legs.value = [{ account_id: form.account_id ?? undefined }, {}]
})
</script>

<template>
  <div class="payment-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ title }}</h3>
        <div class="actions">
          <el-button @click="router.push(listRoute)">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="90px" class="form" inline>
        <el-form-item :label="isReceipt ? '客户' : '供应商'">
          <el-select
            v-model="form.partner_id"
            filterable
            clearable
            @change="loadOpenBills(form.partner_id)"
            :placeholder="isReceipt ? '选择客户（可空）' : '选择供应商（可空）'"
            style="width: 200px"
          >
            <el-option
              v-for="p in partnerOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id as number"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="结算方式"><el-switch v-model="split" active-text="组合账户" inactive-text="单一账户" /></el-form-item>
        <el-form-item v-if="!split" label="账户" required>
          <el-select v-model="form.account_id" placeholder="结算账户" style="width: 180px">
            <el-option v-for="a in accountOptions" :key="a.id" :label="a.name" :value="a.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" :controls="false" placeholder="金额" style="width: 160px" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="备注" style="width: 260px" />
        </el-form-item>
      </el-form>

      <section v-if="split" class="settlement-section">
        <h4>资金分录 · 合计 ¥{{ accountTotal.toFixed(2) }}</h4>
        <div v-for="(leg, index) in legs" :key="index" class="settlement-leg">
          <el-select v-model="leg.account_id" placeholder="选择结算账户" style="width: 200px">
            <el-option v-for="account in accountOptions.filter((item) => !item.disabled)" :key="account.id" :value="account.id!" :label="account.name" />
          </el-select>
          <el-input-number v-model="leg.amount" :min="0" :precision="2" :controls="false" placeholder="分录金额" />
          <el-button link type="danger" :disabled="legs.length <= 2" @click="legs.splice(index, 1)">移除</el-button>
        </div>
        <el-button :disabled="legs.length >= 20" @click="legs.push({})">添加账户</el-button>
      </section>

      <section v-if="form.partner_id" class="settlement-section">
        <h4>核销明细 · 已选 ¥{{ totalAllocated.toFixed(2) }}</h4>
        <el-table v-loading="loadingBills" :data="openBills" max-height="320" empty-text="暂无待核销单据">
          <el-table-column prop="no" label="来源单号" min-width="148" />
          <el-table-column prop="date" label="业务日期" width="115" />
          <el-table-column label="待核销金额" align="right" min-width="120"><template #default="{ row }">{{ row.remaining.toFixed(2) }}</template></el-table-column>
          <el-table-column label="本次核销" align="right" width="170"><template #default="{ row }">
            <el-input-number v-model="assigned[row.id]" :min="0" :max="row.remaining" :precision="2" :controls="false" size="small" />
          </template></el-table-column>
        </el-table>
      </section>

      <el-alert
        title="保存时同步记入各资金账户和所选单据。未分配金额只计入往来汇总。"
        type="info"
        :closable="false"
        class="tip"
      />
    </el-card>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.title {
  margin: 0;
}
.tip {
  margin-top: 8px;
}
.settlement-section { margin: 12px 0 20px; }
.settlement-section h4 { margin: 0 0 10px; }
.settlement-leg { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
</style>
