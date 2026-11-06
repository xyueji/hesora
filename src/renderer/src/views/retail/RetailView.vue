<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { retailApi } from '../../api/retail'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { fundApi } from '../../api/fund'
import type { Product } from '../../../../shared/types/product'
import type { FundAccount } from '../../../../shared/types/fund'

interface Line {
  product_id: number
  name: string
  unit: string
  rate: number
  qty: number
  price: number
}

interface Warehouse {
  id: number
  name: string
}

const barcodeInput = ref<HTMLInputElement | null>(null)
const barcode = ref('')
const warehouseOptions = ref<Warehouse[]>([])
const accountOptions = ref<FundAccount[]>([])

const form = reactive({
  warehouse_id: null as number | null,
  remark: ''
})

const lines = ref<Line[]>([])

const saving = ref(false)

const totalAmount = computed(() =>
  lines.value.reduce((sum, l) => sum + l.qty * l.price * (l.rate || 1), 0)
)

const payVisible = ref(false)
const payForm = reactive({
  account_id: null as number | null,
  received: null as number | null
})
const changeAmount = computed(() => {
  const received = Number(payForm.received ?? 0)
  return received - totalAmount.value
})

function focusBarcode(): void {
  void nextTick(() => barcodeInput.value?.focus())
}

async function loadWarehouses(): Promise<void> {
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouseOptions.value = r.list
    const def = r.list.find((w) => w.is_default) ?? r.list[0]
    if (def?.id !== undefined) form.warehouse_id = def.id
  } catch {
    /* 静默 */
  }
}

async function loadAccounts(): Promise<void> {
  try {
    const r = await fundApi.query({ page: 1, pageSize: 100 })
    accountOptions.value = r.list
    const def = r.list[0]
    if (def?.id !== undefined) payForm.account_id = def.id
  } catch {
    /* 静默 */
  }
}

async function resolveProduct(keyword: string): Promise<Product | null> {
  const r = await productApi.query({ page: 1, pageSize: 1, keyword })
  return r.list[0] ?? null
}

async function onBarcodeEnter(): Promise<void> {
  const kw = barcode.value.trim()
  if (!kw) return
  try {
    const p = await resolveProduct(kw)
    if (!p) {
      ElMessage.warning(`未找到商品：${kw}`)
      return
    }
    appendLine(p)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    barcode.value = ''
    focusBarcode()
  }
}

function appendLine(p: Product): void {
  const existing = lines.value.find((l) => l.product_id === p.id)
  if (existing) {
    existing.qty += 1
  } else {
    lines.value.push({
      product_id: p.id,
      name: `${p.code} ${p.name}`,
      unit: p.base_unit,
      rate: 1,
      qty: 1,
      price: p.retail_price
    })
  }
}

function lineAmount(l: Line): number {
  return l.qty * l.price * (l.rate || 1)
}

function removeLine(index: number): void {
  lines.value.splice(index, 1)
  focusBarcode()
}

function openPay(): void {
  if (lines.value.length === 0) {
    ElMessage.warning('请先扫描或添加商品')
    return
  }
  if (form.warehouse_id === null) {
    ElMessage.warning('请选择仓库')
    return
  }
  payForm.received = Number(totalAmount.value.toFixed(2))
  payVisible.value = true
}

async function savePay(): Promise<void> {
  if (payForm.account_id === null) {
    ElMessage.warning('请选择收款账户')
    return
  }
  saving.value = true
  try {
    await retailApi.create({
      warehouse_id: form.warehouse_id as number,
      account_id: payForm.account_id,
      remark: form.remark || undefined,
      items: lines.value.map((l) => ({
        product_id: l.product_id,
        unit: l.unit,
        rate: l.rate,
        qty: l.qty,
        price: l.price
      }))
    })
    payVisible.value = false
    ElMessage.success(`收款完成，合计 ¥${totalAmount.value.toFixed(2)}，找零 ¥${Math.max(changeAmount.value, 0).toFixed(2)}`)
    // TODO(P3+): 打印小票
    lines.value = []
    form.remark = ''
    focusBarcode()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

onMounted(() => {
  void loadWarehouses()
  void loadAccounts()
  focusBarcode()
})
</script>

<template>
  <div class="retail-pos">
    <el-card shadow="never" class="top-card">
      <div class="top-row">
        <el-input
          ref="barcodeInput"
          v-model="barcode"
          class="barcode-input"
          size="large"
          placeholder="扫码枪输入条码，或输入商品名关键字后回车"
          clearable
          @keyup.enter="onBarcodeEnter"
        />
        <el-select v-model="form.warehouse_id" size="large" class="wh-select" placeholder="仓库">
          <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id as number" />
        </el-select>
      </div>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-table :data="lines" stripe height="100%">
        <el-table-column prop="name" label="商品" min-width="200" />
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column label="数量" width="150" align="right">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="1" :step="1" size="small" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="150" align="right">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" :step="0.5" size="small" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">{{ fmt(lineAmount(row)) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" @click="removeLine($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="footer-card">
      <div class="footer-row">
        <el-input v-model="form.remark" placeholder="备注（可选）" class="remark" />
        <div class="total">
          合计：<span class="total-num">¥{{ fmt(totalAmount) }}</span>
        </div>
        <el-button type="primary" size="large" class="pay-btn" @click="openPay">收款 (F2)</el-button>
      </div>
    </el-card>

    <el-dialog v-model="payVisible" title="收款" width="420px" @open="focusBarcode">
      <el-form label-width="90px">
        <el-form-item label="合计金额">
          <span class="pay-total">¥{{ fmt(totalAmount) }}</span>
        </el-form-item>
        <el-form-item label="收款账户">
          <el-select v-model="payForm.account_id" placeholder="选择账户" style="width: 100%">
            <el-option v-for="a in accountOptions" :key="a.id" :label="a.name" :value="a.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="实收金额">
          <el-input-number v-model="payForm.received" :min="0" :precision="2" :step="1" style="width: 100%" @keyup.enter="savePay" />
        </el-form-item>
        <el-form-item label="找零">
          <span class="change" :class="{ neg: changeAmount < 0 }">¥{{ fmt(Math.max(changeAmount, 0)) }}</span>
          <span v-if="changeAmount < 0" class="neg-tip">（实收不足）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePay">保存收款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.retail-pos {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}
.top-row {
  display: flex;
  gap: 12px;
}
.barcode-input {
  flex: 1;
}
.wh-select {
  width: 180px;
}
.table-card {
  flex: 1;
  overflow: hidden;
}
.footer-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.remark {
  width: 240px;
}
.total {
  margin-left: auto;
  font-size: 16px;
}
.total-num {
  font-size: 28px;
  font-weight: 700;
  color: #e6722e;
}
.pay-btn {
  min-width: 130px;
}
.pay-total {
  font-size: 22px;
  font-weight: 700;
}
.change {
  font-size: 18px;
  font-weight: 600;
}
.change.neg,
.neg-tip {
  color: #f56c6c;
}
</style>
