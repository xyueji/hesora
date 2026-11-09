<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productApi } from '../../api/product'
import { productAttributeApi } from '../../api/product-attribute'
import type { Product, ProductUnit, TrackingType, ProductKind, ProductAttribute } from '../../../../shared/types/product'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<Product>({
  code: '',
  name: '',
  spec: '',
  category: '',
  base_unit: '',
  retail_price: 0,
  trade_price: 0,
  purchase_price: 0,
  min_stock: null,
  remark: '',
  tracking_type: 'none',
  kind: 'standard',
  bom: [],
  units: [],
  barcodes: []
})

const unitRows = ref<ProductUnit[]>([])
const barcodes = ref<string[]>([])
const newBarcode = ref('')
const saving = ref(false)

// ── P2：商品自定义属性（{attr_id: value} 映射）──
const attrDict = ref<ProductAttribute[]>([])
interface AttrLine { attr_id: number | null; value: string }
const attrLines = ref<AttrLine[]>([])

function addAttrLine(): void {
  attrLines.value.push({ attr_id: null, value: '' })
}
function removeAttrLine(i: number): void {
  attrLines.value.splice(i, 1)
}
function attrOptions(attrId: number | null): string[] {
  const a = attrDict.value.find((x) => x.id === attrId)
  if (!a) return []
  try {
    const v = JSON.parse(a.options) as unknown
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}
function collectAttributes(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of attrLines.value) {
    if (line.attr_id !== null && line.value.trim() !== '') out[String(line.attr_id)] = line.value.trim()
  }
  return out
}

async function loadAttrDict(): Promise<void> {
  try {
    attrDict.value = await productAttributeApi.list()
  } catch {
    attrDict.value = []
  }
}

const trackingOptions: { value: TrackingType; label: string }[] = [
  { value: 'none', label: '不追踪' },
  { value: 'batch', label: '批次' },
  { value: 'serial', label: '序列号' }
]

const kindOptions: { value: ProductKind; label: string }[] = [
  { value: 'standard', label: '标准商品' },
  { value: 'combo', label: '组合商品' }
]

const isCombo = computed(() => form.value.kind === 'combo')

// BOM 子件行
interface BomRow {
  product_id: number | null
  product: Product | null
  qty: number | null
}
const bomRows = ref<BomRow[]>([])
const childOptions = ref<Product[]>([])

function addBomRow(): void {
  bomRows.value.push({ product_id: null, product: null, qty: 1 })
}

function removeBomRow(index: number): void {
  bomRows.value.splice(index, 1)
}

async function searchChildren(keyword: string): Promise<void> {
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    childOptions.value = r.list.filter((p) => p.id !== id.value && p.kind !== 'combo')
  } catch {
    /* 静默 */
  }
}

function onChildSelect(row: BomRow): void {
  row.product = childOptions.value.find((p) => p.id === row.product_id) ?? null
}

function addUnit(): void {
  unitRows.value.push({ unit: '', rate: 1 })
}

function removeUnit(index: number): void {
  unitRows.value.splice(index, 1)
}

function addBarcode(): void {
  const v = newBarcode.value.trim()
  if (!v) return
  if (barcodes.value.includes(v)) {
    ElMessage.warning('条码已存在')
    return
  }
  barcodes.value.push(v)
  newBarcode.value = ''
}

function removeBarcode(b: string): void {
  barcodes.value = barcodes.value.filter((x) => x !== b)
}

async function load(): Promise<void> {
  if (!isEdit.value) return
  try {
    const p = await productApi.get(id.value!)
    if (!p) {
      ElMessage.error('商品不存在')
      return
    }
    form.value = p
    unitRows.value = p.units ? [...p.units] : []
    barcodes.value = p.barcodes ? [...p.barcodes] : []
    bomRows.value = (p.bom ?? []).map((b) => ({ product_id: b.product_id, product: null, qty: b.qty }))
    // 属性行：从 {attr_id: value} 还原
    attrLines.value = Object.entries(p.attributes ?? {}).map(([k, v]) => ({
      attr_id: Number(k) || null,
      value: String(v)
    }))
    for (const row of bomRows.value) {
      try {
        if (row.product_id !== null) row.product = await productApi.get(row.product_id)
      } catch {
        row.product = null
      }
    }
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function save(): Promise<void> {
  if (!form.value.code.trim() || !form.value.name.trim() || !form.value.base_unit.trim()) {
    ElMessage.warning('编码、名称、基本单位为必填项')
    return
  }
  if (isCombo.value) {
    const bom = bomRows.value.filter((r) => r.product_id !== null && (r.qty ?? 0) > 0)
    if (bom.length === 0) {
      ElMessage.warning('组合商品必须至少配置一个子件')
      return
    }
    if (bom.length !== bomRows.value.length) {
      ElMessage.warning('BOM 子件行存在未选择商品或数量不大于0的记录')
      return
    }
  }
  saving.value = true
  try {
    const payload: Omit<Product, 'id'> = {
      ...form.value,
      units: unitRows.value,
      barcodes: barcodes.value,
      kind: form.value.kind ?? 'standard',
      bom: isCombo.value
        ? bomRows.value.map((r) => ({ product_id: r.product_id as number, qty: r.qty as number }))
        : []
    }
    payload.attributes = collectAttributes()
    if (isEdit.value) await productApi.update(id.value!, payload)
    else await productApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/product/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
  void loadAttrDict()
})
</script>

<template>
  <div class="product-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑商品' : '新增商品' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/product/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="100px" class="form">
        <div class="section-title">基本信息</div>
        <div class="grid">
          <el-form-item label="编码" required>
            <el-input v-model="form.code" :disabled="isEdit" placeholder="商品编码" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="商品名称" />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="form.spec" placeholder="规格型号" />
          </el-form-item>
          <el-form-item label="类别">
            <el-input v-model="form.category" placeholder="商品类别" />
          </el-form-item>
          <el-form-item label="基本单位" required>
            <el-input v-model="form.base_unit" placeholder="如：罐 / 瓶 / 个" />
          </el-form-item>
          <el-form-item label="商品类型">
            <el-radio-group v-model="form.kind" :disabled="isEdit">
              <el-radio v-for="k in kindOptions" :key="k.value" :value="k.value">
                {{ k.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="!isCombo" label="追踪方式">
            <el-radio-group v-model="form.tracking_type">
              <el-radio v-for="t in trackingOptions" :key="t.value" :value="t.value">
                {{ t.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </div>

        <div class="section-title">价格</div>
        <div class="grid">
          <el-form-item label="零售价">
            <el-input-number v-model="form.retail_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="批发价">
            <el-input-number v-model="form.trade_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="进货价">
            <el-input-number v-model="form.purchase_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="最低库存">
            <el-input-number v-model="form.min_stock" :min="0" :value-on-clear="null" />
          </el-form-item>
          <el-form-item v-if="!isCombo && form.tracking_type === 'batch'" label="保质期(天)">
            <el-input-number v-model="form.shelf_life_days" :min="1" :value-on-clear="null" placeholder="按批次启用" />
          </el-form-item>
          <el-form-item v-if="!isCombo && form.tracking_type === 'batch'" label="临期预警(天)">
            <el-input-number v-model="form.shelf_life_warn_days" :min="1" :value-on-clear="null" placeholder="默认30天" />
          </el-form-item>
        </div>

        <template v-if="!isCombo">
        <div class="section-title">多单位</div>
        <el-table :data="unitRows" size="small" class="units-table" empty-text="暂无多单位，可点击下方添加">
          <el-table-column label="单位" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.unit" placeholder="如：箱" />
            </template>
          </el-table-column>
          <el-table-column label="换算率" min-width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.rate" :min="0" :precision="2" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeUnit($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button class="mt" size="small" @click="addUnit">添加单位</el-button>

        <div class="section-title">条码</div>
        <div class="barcodes">
          <el-tag
            v-for="b in barcodes"
            :key="b"
            closable
            class="barcode-tag"
            @close="removeBarcode(b)"
          >
            {{ b }}
          </el-tag>
          <el-input
            v-model="newBarcode"
            placeholder="输入条码后回车添加"
            class="barcode-input"
            size="small"
            @keyup.enter="addBarcode"
          />
        </div>
        </template>

        <template v-if="isCombo">
          <div class="section-title">BOM 子件清单</div>
          <el-table :data="bomRows" size="small" class="units-table" empty-text="暂无子件，可点击下方添加">
            <el-table-column label="子件商品" min-width="220">
              <template #default="{ row }">
                <el-select
                  v-model="row.product_id"
                  filterable
                  remote
                  :remote-method="searchChildren"
                  :loading="false"
                  placeholder="搜索标准商品"
                  @focus="searchChildren('')"
                  @change="onChildSelect(row)"
                  style="width: 100%"
                >
                  <el-option
                    v-for="p in childOptions"
                    :key="p.id"
                    :label="`${p.code} ${p.name}`"
                    :value="p.id as number"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="单位" width="90">
              <template #default="{ row }">{{ row.product?.base_unit ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="用量" min-width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.qty" :min="0" :precision="2" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ $index }">
                <el-button link type="danger" @click="removeBomRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button class="mt" size="small" @click="addBomRow">添加子件</el-button>
        </template>

        <div class="section-title">自定义属性</div>
        <div v-for="(line, i) in attrLines" :key="i" class="attr-line">
          <el-select v-model="line.attr_id" filterable placeholder="选择属性" style="width: 180px" clearable>
            <el-option v-for="a in attrDict" :key="a.id" :label="a.name" :value="a.id ?? 0" />
          </el-select>
          <el-select
            v-if="attrOptions(line.attr_id).length > 0"
            v-model="line.value"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入属性值"
            style="width: 200px"
          >
            <el-option v-for="opt in attrOptions(line.attr_id)" :key="opt" :label="opt" :value="opt" />
          </el-select>
          <el-input v-else v-model="line.value" placeholder="属性值" style="width: 200px" clearable />
          <el-button link type="danger" @click="removeAttrLine(i)">删除</el-button>
        </div>
        <el-button link type="primary" @click="addAttrLine">+ 添加属性</el-button>

        <div class="section-title">备注</div>
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.product-edit {
  padding: 16px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.title {
  margin: 0;
  font-size: 16px;
}
.form {
  max-width: 860px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 12px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 24px;
}
.units-table {
  max-width: 560px;
}
.mt {
  margin-top: 8px;
}
.barcodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.barcode-input {
  width: 220px;
}
.attr-line {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
</style>
