<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { workflowApi } from '../../api/workflow'
import { customerApi } from '../../api/customer'
import { supplierApi } from '../../api/supplier'
import { warehouseApi } from '../../api/warehouse'
import { productApi } from '../../api/product'
import { WORKFLOW_CONVERSIONS, WORKFLOW_LABELS, type OrderFulfillment, type WorkflowInput, type WorkflowKind, type WorkflowRow } from '../../../../shared/types/workflow'
import { hasPermission } from '../../stores/auth'
import type { Product } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

const rows = ref<WorkflowRow[]>([])
const filter = ref<WorkflowKind>()
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const busy = ref(false)
const editor = ref(false)
const readonly = ref(false)
const linkedOrder = ref(false)
const legacyChild = ref(false)
const editorFulfillment = ref<OrderFulfillment>()
const batching = ref<{ order: WorkflowRow; target: WorkflowKind }>()
const batchVisible = ref(false)
const batchQuantities = ref<Record<number, number | undefined>>({})
const batchProducts = ref<Record<number, string>>({})
const form = ref<WorkflowInput>(newDraft())
const products = ref<Product[]>([])
const partners = ref<{ id?: number; code: string; name: string }[]>([])
const warehouses = ref<Warehouse[]>([])
const isPurchase = computed(() => form.value.kind === 'purchase' || form.value.kind === 'purchase_order')
const totalAmount = computed(() => form.value.items.reduce((sum, line) => sum + line.qty * line.price, 0))
const statusLabels = { draft: '草稿', approved: '已审核', cancelled: '已取消' }
function isReversedBatch(row: unknown): boolean {
  return !!(row as { reversed?: boolean }).reversed
}
const fulfillmentLabels = { pending: '待履行', reserved: '有草稿待审核', partial: '部分履行', completed: '已履行', legacy: '历史整单转单' }
const allowedLabels = computed(() => Object.entries(WORKFLOW_LABELS).filter(([kind]) =>
  hasPermission(kind === 'purchase' || kind === 'purchase_order' ? 'doc.purchase' : 'doc.sale')))

function newDraft(): WorkflowInput {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return { kind: hasPermission('doc.sale') ? 'quote' : 'purchase_order', warehouse_id: 0, date, items: [] }
}

function notify(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : String(error))
}

async function load() {
  loading.value = true
  try {
    const data = await workflowApi.list(page.value, filter.value)
    rows.value = data.list
    total.value = data.total
  } catch (error) {
    notify(error)
  } finally {
    loading.value = false
  }
}

async function searchProducts(keyword: string) {
  try {
    const result = await productApi.query({ page: 1, pageSize: 50, keyword })
    const selected = products.value.filter((p) => form.value.items.some((line) => line.product_id === p.id))
    products.value = [...new Map([...selected, ...result.list].map((p) => [p.id, p])).values()]
  } catch (error) {
    notify(error)
  }
}

async function searchPartners(keyword: string) {
  try {
    const api = isPurchase.value ? supplierApi : customerApi
    const result = await api.query({ page: 1, pageSize: 50, keyword })
    partners.value = result.list
  } catch (error) {
    notify(error)
  }
}

async function open(row?: WorkflowRow, copy = false) {
  busy.value = true
  try {
    form.value = row ? JSON.parse(JSON.stringify(row)) as WorkflowInput : newDraft()
    readonly.value = !!row && row.status !== 'draft' && !copy
    linkedOrder.value = !copy && (row?.source_kind === 'sale_order' || row?.source_kind === 'purchase_order')
    legacyChild.value = linkedOrder.value && form.value.items.some((item) => item.source_line === undefined)
    editorFulfillment.value = copy ? undefined : row?.fulfillment
    if (copy) {
      form.value.id = undefined
      form.value.date = newDraft().date
    }
    warehouses.value = (await warehouseApi.query({ page: 1, pageSize: 100 })).list
    if (!row) form.value.warehouse_id = warehouses.value.find((w) => w.is_default)?.id ?? warehouses.value[0]?.id ?? 0
    products.value = (await Promise.all(form.value.items.map((item) => productApi.get(item.product_id)))).filter((p): p is Product => !!p)
    await searchPartners('')
    if (form.value.partner_id && !partners.value.some((p) => p.id === form.value.partner_id)) {
      const selected = await (isPurchase.value ? supplierApi : customerApi).get(form.value.partner_id)
      if (selected) partners.value.push(selected)
    }
    editor.value = true
  } catch (error) {
    notify(error)
  } finally {
    busy.value = false
  }
}

function options(productId: number) {
  const product = products.value.find((p) => p.id === productId)
  return product ? [{ unit: product.base_unit, rate: 1 }, ...(product.units ?? []).filter((u) => u.unit !== product.base_unit)] : []
}

function onProduct(line: WorkflowInput['items'][number]) {
  const product = products.value.find((p) => p.id === line.product_id)
  if (!product) return
  line.unit = product.base_unit
  line.rate = 1
  line.price = (isPurchase.value ? product.purchase_price : product.trade_price || product.retail_price) ?? 0
}

function onUnit(line: WorkflowInput['items'][number]) {
  const rate = options(line.product_id).find((unit) => unit.unit === line.unit)?.rate ?? 1
  line.price = line.price / (line.rate ?? 1) * rate
  line.rate = rate
}

async function save() {
  busy.value = true
  try {
    await workflowApi.save(form.value)
    editor.value = false
    ElMessage.success('草稿已保存')
    page.value = 1
    await load()
  } catch (error) {
    notify(error)
  } finally {
    busy.value = false
  }
}

async function run(row: WorkflowRow, action: 'approve' | 'convert' | 'cancel', target?: WorkflowKind) {
  if (action === 'convert' && target && row.fulfillment) {
    batching.value = { order: row, target }
    batchQuantities.value = Object.fromEntries(row.fulfillment.lines.map((line) => [line.line, line.remaining]))
    batchProducts.value = {}
    batchVisible.value = true
    const ids = new Set(row.fulfillment.lines.map((line) => line.product_id))
    await Promise.all([...ids].map(async (id) => {
      const product = await productApi.get(id).catch(() => null)
      if (product && batching.value?.order.id === row.id) batchProducts.value[id] = `${product.code} ${product.name}`
    }))
    return
  }
  const labels = { approve: '审核', convert: target ? `转为${WORKFLOW_LABELS[target]}` : '转单', cancel: '取消草稿' }
  try {
    await ElMessageBox.confirm(`确认${labels[action]}${WORKFLOW_LABELS[row.kind]} #${row.id}？`, labels[action], { type: 'warning' })
  } catch {
    return
  }
  busy.value = true
  try {
    if (action === 'approve') {
      const result = await workflowApi.approve(row.id)
      ElMessage.success(result.posted_doc_no ? `已审核过账：${result.posted_doc_no}` : '审核成功')
    } else if (action === 'convert' && target) {
      const result = await workflowApi.convert(row.id, target)
      ElMessage.success(`已生成${WORKFLOW_LABELS[result.kind]}草稿 #${result.id}`)
      filter.value = undefined
      page.value = 1
    } else if (action === 'cancel') {
      await workflowApi.cancel(row.id)
      ElMessage.success('草稿已取消')
    }
    await load()
  } catch (error) {
    notify(error)
  } finally {
    busy.value = false
  }
}

async function saveBatch() {
  if (!batching.value || busy.value) return
  const { order, target } = batching.value
  const quantities = Object.entries(batchQuantities.value).flatMap(([line, qty]) => qty && qty > 0 ? [{ line: Number(line), qty }] : [])
  if (!quantities.length) {
    ElMessage.warning('请为至少一个订单行填写本次数量')
    return
  }
  busy.value = true
  try {
    const result = await workflowApi.convert(order.id, target, quantities)
    batchVisible.value = false
    ElMessage.success(`已生成${WORKFLOW_LABELS[result.kind]}草稿 #${result.id}`)
    await load()
    await open(result)
  } catch (error) {
    notify(error)
    await load()
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="workflow-page">
    <el-card shadow="never">
      <template #header>
        <div class="workflow-header"><div><h2>报价、订单与单据审核</h2><p>草稿不影响库存。进货单和销售单审核后正式过账。</p></div>
          <el-button type="primary" :disabled="busy || !allowedLabels.length" @click="open()">新建单据</el-button></div>
      </template>
      <el-select v-model="filter" clearable placeholder="全部单据类型" style="width: 190px; margin-bottom: 16px" @change="page = 1; load()">
        <el-option v-for="[value, label] in allowedLabels" :key="value" :value="value" :label="label" />
      </el-select>
      <el-table v-loading="loading" :data="rows" row-key="id" empty-text="暂无单据">
        <el-table-column prop="id" label="编号" width="76" />
        <el-table-column label="类型" min-width="100"><template #default="{ row }">{{ WORKFLOW_LABELS[(row as WorkflowRow).kind] }}</template></el-table-column>
        <el-table-column prop="date" label="日期" min-width="106" />
        <el-table-column label="状态" width="95"><template #default="{ row }">{{ statusLabels[(row as WorkflowRow).status] }}</template></el-table-column>
        <el-table-column label="履行进度" min-width="110"><template #default="{ row }">
          {{ (row as WorkflowRow).status === 'approved' && (row as WorkflowRow).fulfillment ? fulfillmentLabels[(row as WorkflowRow).fulfillment!.state] : '—' }}
        </template></el-table-column>
        <el-table-column label="来源 / 过账单号" min-width="165"><template #default="{ row }">{{ row.source_id ? `#${row.source_id}` : '—' }} / {{ row.posted_doc_no || '—' }}</template></el-table-column>
        <el-table-column label="操作" width="270" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="busy" @click="open(row)">{{ row.status === 'draft' ? '编辑' : '查看' }}</el-button>
            <el-button link :disabled="busy" @click="open(row, true)">复制</el-button>
            <template v-if="row.status === 'draft'">
              <el-button v-if="hasPermission('doc.approve')" link type="primary" :disabled="busy" @click="run(row, 'approve')">审核</el-button>
              <el-button link type="danger" :disabled="busy" @click="run(row, 'cancel')">取消草稿</el-button>
            </template>
            <template v-if="hasPermission('doc.approve') && row.status === 'approved' && (row.fulfillment ? (row as WorkflowRow).fulfillment?.lines.some((line) => line.remaining > 0) : !row.converted_id)">
              <el-button v-for="target in WORKFLOW_CONVERSIONS[(row as WorkflowRow).kind]" :key="target" link type="primary" :disabled="busy" @click="run(row, 'convert', target)">{{ row.fulfillment ? '分批转' : '转' }}{{ WORKFLOW_LABELS[target] }}</el-button>
            </template>
            <span v-if="row.converted_id && !row.fulfillment">已转 #{{ row.converted_id }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination v-model:current-page="page" :page-size="30" :total="total" layout="total, prev, pager, next" @current-change="load" />
    </el-card>

    <el-dialog v-model="editor" :title="readonly ? '查看单据' : '编辑单据草稿'" width="min(94vw, 1040px)" destroy-on-close :close-on-click-modal="false">
      <el-form inline :disabled="readonly || busy">
        <el-form-item label="类型">
          <el-select v-model="form.kind" :disabled="!!form.id" style="width: 138px" @change="form.partner_id = undefined; searchPartners('')">
            <el-option v-for="[value, label] in allowedLabels" :key="value" :value="value" :label="label" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" type="date" /></el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="form.warehouse_id" :disabled="linkedOrder" style="width: 170px">
            <el-option v-for="w in warehouses" :key="w.id" :value="w.id ?? 0" :label="w.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="isPurchase ? '供应商' : '客户'">
          <el-select v-model="form.partner_id" :disabled="linkedOrder" filterable remote clearable :remote-method="searchPartners" style="width: 200px" placeholder="搜索往来单位">
            <el-option v-for="p in partners" :key="p.id" :value="p.id ?? 0" :label="`${p.code} ${p.name}`" />
          </el-select>
        </el-form-item>
        <el-table :data="form.items" empty-text="点击添加商品录入明细">
          <el-table-column label="商品" min-width="210"><template #default="{ row }">
            <el-select v-model="row.product_id" :disabled="linkedOrder" filterable remote :remote-method="searchProducts" placeholder="搜索商品编码或名称" @focus="searchProducts('')" @change="onProduct(row)">
              <el-option v-for="p in products" :key="p.id" :value="p.id ?? 0" :label="`${p.code} ${p.name}`" />
            </el-select>
          </template></el-table-column>
          <el-table-column label="单位" min-width="92"><template #default="{ row }">
            <el-select v-model="row.unit" :disabled="linkedOrder" @change="onUnit(row)"><el-option v-for="u in options(row.product_id)" :key="u.unit" :label="u.unit" :value="u.unit" /></el-select>
          </template></el-table-column>
          <el-table-column label="批次" min-width="108"><template #default="{ row }"><el-input v-model="row.batch_no" :disabled="legacyChild" /></template></el-table-column>
          <el-table-column label="数量" min-width="105"><template #default="{ row }"><el-input-number v-model="row.qty" :disabled="legacyChild" :min="0" :controls="false" style="width: 100%" /></template></el-table-column>
          <el-table-column label="单价" min-width="105"><template #default="{ row }"><el-input-number v-model="row.price" :disabled="linkedOrder" :min="0" :controls="false" style="width: 100%" /></template></el-table-column>
          <el-table-column v-if="!readonly && !legacyChild" width="75"><template #default="{ $index }"><el-button link type="danger" @click="form.items.splice($index, 1)">移除</el-button></template></el-table-column>
        </el-table>
        <div class="workflow-header" style="margin: 14px 0"><el-button v-if="!readonly && !linkedOrder" @click="form.items.push({ product_id: 0, qty: 1, price: 0, rate: 1 })">添加商品</el-button><strong>合计 ¥{{ totalAmount.toFixed(2) }}</strong></div>
        <el-input v-model="form.remark" type="textarea" placeholder="单据备注" />
      </el-form>
      <template v-if="editorFulfillment && readonly">
        <h3>订单履行明细</h3>
        <el-alert v-if="editorFulfillment.state === 'legacy'" title="历史整单转单未记录订单行数量，保留原关联。" type="info" :closable="false" />
        <el-table v-else :data="editorFulfillment.lines">
          <el-table-column label="订单行" width="90"><template #default="{ row }">{{ row.line + 1 }}</template></el-table-column>
          <el-table-column prop="unit" label="单位" /><el-table-column prop="qty" label="订购" />
          <el-table-column prop="posted" label="已过账" /><el-table-column prop="reserved" label="草稿占用" />
          <el-table-column prop="remaining" label="可转数量" />
        </el-table>
        <template v-if="editorFulfillment.batches.length">
          <h3>关联批次</h3>
          <el-table :data="editorFulfillment.batches">
            <el-table-column prop="id" label="草稿编号" width="100" />
            <el-table-column prop="date" label="业务日期" />
            <el-table-column label="状态"><template #default="{ row }">
              <el-tag v-if="isReversedBatch(row)" type="info" size="small">已红冲</el-tag>
              <span v-else>{{ statusLabels[(row as WorkflowRow).status] }}</span>
            </template></el-table-column>
            <el-table-column prop="postedNo" label="正式单号" />
          </el-table>
        </template>
      </template>
      <template #footer><el-button @click="editor = false">关闭</el-button><el-button v-if="!readonly" type="primary" :loading="busy" @click="save">保存草稿</el-button></template>
    </el-dialog>

    <el-dialog v-model="batchVisible" title="选择本批履行数量" width="min(940px, 94vw)" :close-on-click-modal="false">
      <el-table v-if="batching" :data="batching.order.fulfillment?.lines" data-test="fulfillment-lines">
        <el-table-column label="商品" min-width="180"><template #default="{ row }">{{ batchProducts[row.product_id] || `商品 #${row.product_id}` }}</template></el-table-column>
        <el-table-column prop="unit" label="单位" width="68" /><el-table-column prop="qty" label="订购" width="82" />
        <el-table-column prop="posted" label="已过账" width="94" /><el-table-column prop="reserved" label="草稿占用" width="94" />
        <el-table-column prop="remaining" label="可转" width="82" />
        <el-table-column label="本次数量" width="164"><template #default="{ row }">
          <el-input-number v-model="batchQuantities[row.line]" :min="0" :max="row.remaining" :disabled="!row.remaining || busy" :controls="false" style="width: 100%" />
        </template></el-table-column>
      </el-table>
      <p class="batch-hint">数量为 0 的订单行不生成明细。审核前可取消草稿并释放占用。</p>
      <template #footer><el-button @click="batchVisible = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveBatch">生成本批草稿</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workflow-page { padding: 16px; }
.workflow-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0; font-size: 20px; }
p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 13px; font-weight: 400; }
.batch-hint { margin-top: 14px; }
</style>
