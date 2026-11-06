<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { paymentApi } from '../../api/payment'
import { fundApi } from '../../api/fund'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import type { FundAccount } from '../../../../shared/types/fund'
import type { Customer } from '../../../../shared/types/customer'
import type { Supplier } from '../../../../shared/types/supplier'

const props = defineProps<{ mode: 'receipt' | 'payment' }>()

const router = useRouter()

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
  if (!form.account_id) {
    ElMessage.warning('请选择结算账户')
    return
  }
  if (!form.amount || form.amount <= 0) {
    ElMessage.warning('请输入大于0的金额')
    return
  }
  saving.value = true
  try {
    const input = {
      partner_id: form.partner_id ?? undefined,
      account_id: form.account_id,
      amount: form.amount,
      date: form.date || undefined,
      remark: form.remark || undefined
    }
    const doc = isReceipt.value ? await paymentApi.createReceipt(input) : await paymentApi.createPayment(input)
    ElMessage.success(`保存成功：${doc.no}`)
    router.push(listRoute)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadOptions()
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
        <el-form-item label="账户" required>
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

      <el-alert
        :title="isReceipt ? '收款单保存后自动记一笔资金流入流水' : '付款单保存后自动记一笔资金流出流水'"
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
</style>
