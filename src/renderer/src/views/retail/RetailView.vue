<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Warehouse } from '../../../../shared/types/warehouse'
import { retailApi } from '../../api/retail'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { fundApi } from '../../api/fund'
import { customerApi } from '../../api/customer'
import type { Customer } from '../../../../shared/types/customer'
import { printApi } from '../../api/print'
import { resolveScannedProduct } from '../../composables/useDocumentScanner'
import type { Product } from '../../../../shared/types/product'
import type { FundAccount } from '../../../../shared/types/fund'
import type { RetailCreateInput, RetailHeldCart } from '../../../../shared/types/retail'

interface Line {
  product_id: number
  name: string
  unit: string
  batch_no?: string
  rate: number
  qty: number
  price: number
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
const heldId = ref<number>()
const heldCarts = ref<RetailHeldCart[]>([])
const heldVisible = ref(false)
const holding = ref(false)

const saving = ref(false)

const totalAmount = computed(() =>
  lines.value.reduce((sum, l) => sum + lineAmount(l), 0)
)

const payVisible = ref(false)
const payForm = reactive({
  account_id: null as number | null,
  received: null as number | null,
  discount: 1 as number,
  payLines: [] as Array<{ account_id: number | null; amount: number | null }>,
  // P1 功能 #2 预存款：会员（客户）使用预存款抵扣金额
  customer_id: null as number | null,
  prepaid_amount: null as number | null
})
const payCustomerOptions = ref<Customer[]>([])
const payCustomerPrepaid = ref(0)
const changeAmount = computed(() => {
  const received = Number(payForm.received ?? 0)
  return Number((received - Number(discountedTotal.value.toFixed(2))).toFixed(2))
})

/** 整单折扣后金额 = 合计 × 折扣率（两位小数）。 */
const discountedTotal = computed(() =>
  Number((totalAmount.value * (payForm.discount > 0 && payForm.discount <= 1 ? payForm.discount : 1)).toFixed(2))
)

const payLinesTotal = computed(() =>
  Number(payForm.payLines.reduce((sum, l) => sum + Number(l.amount ?? 0), 0).toFixed(2))
)

function addPayLine(): void {
  payForm.payLines.push({ account_id: null, amount: null })
}

function removePayLine(index: number): void {
  payForm.payLines.splice(index, 1)
}

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
  return resolveScannedProduct(keyword)
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
  if (p.id === undefined) {
    ElMessage.error('无法识别该商品，请重新查询')
    return
  }
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
  return l.qty * l.price
}

function removeLine(index: number): void {
  lines.value.splice(index, 1)
  focusBarcode()
}

function cartPayload(): RetailCreateInput {
  if (form.warehouse_id === null) throw new Error('请选择仓库')
  const payload: RetailCreateInput = {
    held_id: heldId.value,
    warehouse_id: form.warehouse_id,
    remark: form.remark || undefined,
    items: lines.value.map(({ name: _name, ...line }) => line)
  }
  // P1 功能 #2：会员预存款抵扣（仅已选会员且金额 > 0 时带上）
  if (payForm.customer_id !== null && payForm.prepaid_amount !== null && payForm.prepaid_amount > 0) {
    payload.customer_id = payForm.customer_id
    payload.prepaid_amount = payForm.prepaid_amount
  }
  return payload
}

function clearCart(): void {
  heldId.value = undefined
  lines.value = []
  form.remark = ''
  focusBarcode()
}

async function holdCart(): Promise<void> {
  if (holding.value || lines.value.length === 0) return
  holding.value = true
  try {
    await retailApi.hold(cartPayload())
    clearCart()
    ElMessage.success('已挂单')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    holding.value = false
  }
}

async function showHeldCarts(): Promise<void> {
  try {
    heldCarts.value = await retailApi.listHeld()
    heldVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function resumeCart(cart: RetailHeldCart): Promise<void> {
  if (lines.value.length > 0) {
    ElMessage.warning('请先挂起或结算当前商品')
    return
  }
  holding.value = true
  try {
    const restored = await Promise.all(cart.input.items.map(async (item) => {
      const product = await productApi.get(item.product_id)
      return {
        ...item,
        name: product ? `${product.code} ${product.name}` : `商品 #${item.product_id}`,
        rate: item.rate ?? 1,
        unit: item.unit ?? product?.base_unit ?? ''
      }
    }))
    lines.value = restored
    form.warehouse_id = cart.input.warehouse_id
    form.remark = cart.input.remark ?? ''
    heldId.value = cart.id
    heldVisible.value = false
    focusBarcode()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    holding.value = false
  }
}

async function discardCart(cart: RetailHeldCart): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除此挂单？', '删除挂单', { type: 'warning' })
  } catch {
    return
  }
  try {
    await retailApi.discardHeld(cart.id)
    if (cart.id === heldId.value) clearCart()
    heldCarts.value = heldCarts.value.filter((c) => c.id !== cart.id)
    ElMessage.success('挂单已删除')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
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
  payForm.discount = 1
  payForm.payLines = []
  payVisible.value = true
}

/** P1 功能 #2：收款弹窗会员远程搜索 + 预存款余额联动 */
async function searchPayCustomers(keyword: string): Promise<void> {
  try {
    const r = await customerApi.query({ page: 1, pageSize: 20, keyword: keyword || undefined })
    payCustomerOptions.value = r.list
  } catch {
    /* 静默：搜索失败不阻断收款 */
  }
}

function onPayCustomerChange(id: number | null): void {
  payForm.prepaid_amount = null
  payCustomerPrepaid.value = 0
  if (id !== null) {
    void customerApi.get(id).then((c) => {
      payCustomerPrepaid.value = c?.prepaid ?? 0
    }).catch(() => { /* 静默 */ })
  }
}

async function savePay(): Promise<void> {
  if (saving.value) return
  const d = Number(payForm.discount)
  if (!Number.isFinite(d) || d <= 0 || d > 1) {
    ElMessage.warning('整单折扣率需在 (0, 1] 之间')
    return
  }
  // P1 功能 #2：预存款抵扣校验（散客不可用；不超余额与应付）
  const prepaidUse = payForm.prepaid_amount ?? 0
  if (prepaidUse > 0 && payForm.customer_id === null) {
    ElMessage.warning('使用预存款请先选择会员（客户）')
    return
  }
  if (prepaidUse > 0 && (payCustomerPrepaid.value < prepaidUse || prepaidUse > Number(discountedTotal.value.toFixed(2)))) {
    ElMessage.warning('预存款抵扣金额不能超过会员预存款余额或应付金额')
    return
  }
  // 组合收款：填了多账户行则按行校验并组装 payments；否则回退单一账户语义。
  const filledLines = payForm.payLines.filter((l) => l.account_id !== null)
  if (filledLines.length > 0) {
    if (filledLines.some((l) => l.amount === null || Number(l.amount) <= 0)) {
      ElMessage.warning('组合收款每行请填写账户与大于 0 的金额')
      return
    }
    if (payLinesTotal.value !== discountedTotal.value) {
      ElMessage.warning(`组合收款各行合计 ¥${payLinesTotal.value.toFixed(2)} 需等于折后金额 ¥${discountedTotal.value.toFixed(2)}`)
      return
    }
  } else if (payForm.account_id === null) {
    ElMessage.warning('请选择收款账户')
    return
  }
  if (changeAmount.value < 0) {
    ElMessage.warning('实收金额不足')
    return
  }
  saving.value = true
  try {
    const doc = await retailApi.create({
      ...cartPayload(),
      ...(filledLines.length > 0
        ? {
            payments: filledLines.map((l) => ({ account_id: l.account_id as number, amount: Number(l.amount) })),
            discount: d !== 1 ? d : undefined
          }
        : { account_id: payForm.account_id as number, discount: d !== 1 ? d : undefined })
    })
    payVisible.value = false
    payForm.customer_id = null
    payForm.prepaid_amount = null
    payCustomerPrepaid.value = 0
    lastReceiptDocId.value = doc.id
    ElMessage.success(`收款完成，合计 ¥${discountedTotal.value.toFixed(2)}，找零 ¥${Math.max(changeAmount.value, 0).toFixed(2)}`)
    clearCart()
    void offerPrintReceipt(doc.id)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

const lastReceiptDocId = ref<number | null>(null)
const printingReceipt = ref(false)

async function offerPrintReceipt(docId: number): Promise<void> {
  try {
    await ElMessageBox.confirm('收款完成，是否打印小票？', '打印小票', {
      confirmButtonText: '打印',
      cancelButtonText: '不打印',
      type: 'success'
    })
    await doPrintReceipt(docId)
  } catch {
    // 用户选择不打印（或确认框关闭），忽略
  }
}

async function reprintReceipt(): Promise<void> {
  if (lastReceiptDocId.value === null) return
  await doPrintReceipt(lastReceiptDocId.value)
}

async function doPrintReceipt(docId: number): Promise<void> {
  printingReceipt.value = true
  try {
    await printApi.receipt(docId)
    ElMessage.success('小票已发送到打印机')
  } catch (e) {
    ElMessage.error(`打印失败：${(e as Error).message}`)
  } finally {
    printingReceipt.value = false
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function onCashShortcut(event: KeyboardEvent): void {
  if (event.key !== 'F2' || payVisible.value || heldVisible.value) return
  event.preventDefault()
  openPay()
}

onMounted(() => {
  void loadWarehouses()
  void loadAccounts()
  focusBarcode()
  window.addEventListener('keydown', onCashShortcut)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onCashShortcut))
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
        <el-button :disabled="lines.length === 0" :loading="holding" @click="holdCart">挂单</el-button>
        <el-button @click="showHeldCarts">取单</el-button>
        <el-button size="large" :disabled="lastReceiptDocId === null" :loading="printingReceipt" @click="reprintReceipt">打印小票</el-button>
      </div>
    </el-card>

    <el-dialog v-model="heldVisible" title="挂单" width="640px">
      <el-table :data="heldCarts" empty-text="暂无挂单">
        <el-table-column prop="updated_at" label="挂单时间" width="168" />
        <el-table-column prop="input.remark" label="备注" min-width="120" />
        <el-table-column label="商品行数" width="95">
          <template #default="{ row }">{{ row.input.items.length }}</template>
        </el-table-column>
        <el-table-column label="操作" width="126">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="holding" @click="resumeCart(row)">取单</el-button>
            <el-button link type="danger" :disabled="holding" @click="discardCart(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="payVisible" title="收款" width="420px">
      <el-form label-width="90px">
        <el-form-item label="合计金额">
          <span class="pay-total">¥{{ fmt(totalAmount) }}</span>
        </el-form-item>
        <el-form-item label="会员">
          <el-select
            v-model="payForm.customer_id"
            filterable
            remote
            clearable
            :remote-method="searchPayCustomers"
            placeholder="搜索会员（可选）"
            style="width: 100%"
            @change="onPayCustomerChange"
          >
            <el-option v-for="c in payCustomerOptions" :key="c.id" :label="c.name" :value="c.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="payForm.customer_id !== null" label="预存款">
          <span class="prepaid-balance">余额 ¥{{ payCustomerPrepaid.toFixed(2) }}</span>
          <el-input-number
            v-model="payForm.prepaid_amount"
            :min="0"
            :max="Math.min(payCustomerPrepaid, discountedTotal)"
            :precision="2"
            :controls="false"
            placeholder="使用预存款"
            style="width: 130px; margin-left: 10px"
          />
        </el-form-item>
        <el-form-item label="整单折扣">
          <el-input-number v-model="payForm.discount" :min="0.01" :max="1" :step="0.05" :precision="2" style="width: 160px" />
          <span class="discount-total">折后：¥{{ fmt(discountedTotal) }}</span>
        </el-form-item>
        <el-form-item label="收款账户">
          <el-select v-model="payForm.account_id" placeholder="选择账户" style="width: 100%" :disabled="payForm.payLines.length > 0">
            <el-option v-for="a in accountOptions" :key="a.id" :label="a.name" :value="a.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="组合收款">
          <div class="pay-lines">
            <div v-for="(line, idx) in payForm.payLines" :key="idx" class="pay-line">
              <el-select v-model="line.account_id" placeholder="账户" style="width: 55%">
                <el-option v-for="a in accountOptions" :key="a.id" :label="a.name" :value="a.id as number" />
              </el-select>
              <el-input-number v-model="line.amount" :min="0.01" :precision="2" placeholder="金额" style="width: 30%" />
              <el-button link type="danger" @click="removePayLine(idx)">删除</el-button>
            </div>
            <div class="pay-lines-foot">
              <el-button size="small" @click="addPayLine">+ 添加账户行</el-button>
              <span v-if="payForm.payLines.length > 0" class="pay-lines-sum">
                行合计 ¥{{ fmt(payLinesTotal) }} / 折后 ¥{{ fmt(discountedTotal) }}
              </span>
            </div>
          </div>
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
  color: var(--el-color-primary);
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
  color: var(--el-color-danger);
}
.discount-total {
  margin-left: 12px;
  color: var(--el-color-primary);
}
.pay-lines {
  width: 100%;
}
.pay-line {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.pay-lines-foot {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pay-lines-sum {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
