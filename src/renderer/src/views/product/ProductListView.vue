<script setup lang="ts">
import { onActivated, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productApi } from '../../api/product'
import { productAttributeApi } from '../../api/product-attribute'
import { csvApi, readCsvFile } from '../../api/csv'
import { buildCsv } from '../../../../shared/csv'
import { hasPermission } from '../../stores/auth'
import type { BulkUpdatePatch } from '../../../../main/services/product/product.service'
import type { ImportResult, ProductPreview } from '../../api/csv'
import type { Product, ProductAttribute } from '../../../../shared/types/product'

const router = useRouter()

const keyword = ref('')
// P3：货架号模糊筛选
const shelfFilter = ref('')
const loading = ref(false)
const list = ref<Product[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
// ── P2：按自定义属性筛选 ──
const attrDict = ref<ProductAttribute[]>([])
const attrFilters = ref<Record<string, string>>({})
const filterAttrId = ref<number | null>(null)
const filterAttrValue = ref('')

function filterAttrOptions(): string[] {
  const a = attrDict.value.find((x) => x.id === filterAttrId.value)
  if (!a) return []
  try {
    const v = JSON.parse(a.options) as unknown
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function addAttrFilter(): void {
  if (filterAttrId.value === null || filterAttrValue.value.trim() === '') return
  attrFilters.value = { ...attrFilters.value, [String(filterAttrId.value)]: filterAttrValue.value.trim() }
  filterAttrId.value = null
  filterAttrValue.value = ''
  search()
}

function removeAttrFilter(key: string): void {
  const next = { ...attrFilters.value }
  delete next[key]
  attrFilters.value = next
  search()
}

async function loadAttrDict(): Promise<void> {
  try {
    attrDict.value = await productAttributeApi.list()
  } catch {
    attrDict.value = []
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await productApi.query({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      shelf_no: shelfFilter.value || undefined,
      attr_filters: Object.keys(attrFilters.value).length > 0 ? attrFilters.value : undefined
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

async function toggleDisabled(row: Product): Promise<void> {
  try {
    if (row.disabled) await productApi.enable(row.id!)
    else await productApi.disable(row.id!)
    ElMessage.success(row.disabled ? '已启用' : '已停用')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

// P3：主图（第 1 张）预览 data URL，按商品缓存避免重复 IPC
const thumbCache = ref<Map<number, string>>(new Map())
const firstImage = (row: Product): string | null => {
  const pid = row.id
  if (pid === undefined || !row.images || row.images.length === 0) return null
  const hit = thumbCache.value.get(pid)
  if (hit) return hit === '' ? null : hit
  void window.api
    .invoke('productImage:read', { stored_name: row.images[0] })
    .then((r: unknown) => {
      const w = r as { mime: string; data: string }
      thumbCache.value.set(pid, `data:${w.mime};base64,${w.data}`)
    })
    .catch(() => thumbCache.value.set(pid, ''))
  return null
}

const importing = ref(false)
const exporting = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const previewVisible = ref(false)
const previewLoading = ref(false)
const preview = ref<ProductPreview | null>(null)
const pendingCsv = ref('')
// S 级：更新策略——编码已存在时跳过或覆盖可变字段（编码永不覆盖）
const importMode = ref<'skip' | 'update'>('update')
// S 级：最近一次导入结果（用于失败行导出 CSV）
const lastImportResult = ref<ImportResult | null>(null)

/**
 * S 级：纯前端生成导入模板 CSV（含表头 + 示例行），Blob 下载，不经主进程。
 * 列顺序与 PRODUCT_IMPORT_COLUMNS（shared/csv.ts）一致。
 */
function downloadImportTemplate(): void {
  const headers = ['编码', '名称', '规格', '类别', '基本单位', '零售价', '批发价', '进价', '最低库存', '追踪方式', '条码']
  const example = [['SP001', '示例商品', '500ml', '饮料', '瓶', '3.5', '3', '2.5', '10', '无', '6901234567890']]
  const csv = buildCsv(headers, example)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '商品导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** S 级：导出最近一次导入的失败行明细 CSV（行号 + 失败原因），Blob 下载。 */
function downloadFailedRows(): void {
  const r = lastImportResult.value
  if (!r || r.errors.length === 0) return
  const csv = buildCsv(
    ['行号', '失败原因'],
    r.errors.map((er) => [er.row, er.message])
  )
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '导入失败行.csv'
  a.click()
  URL.revokeObjectURL(url)
}

async function doExport(kind: 'products' | 'product-template' = 'products'): Promise<void> {
  exporting.value = true
  try {
    const path = await csvApi.export(kind)
    ElMessage.success(`已导出到：${path}`)
  } catch (e) {
    const msg = (e as Error).message
    if (msg !== '已取消导出') ElMessage.error(msg)
  } finally {
    exporting.value = false
  }
}

function pickImport(): void {
  importInput.value?.click()
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const content = await readCsvFile(file)
    // dry-run 预览：先校验并列出将新建/更新的行，用户确认后再真正导入
    pendingCsv.value = content
    preview.value = await csvApi.previewProducts(content)
    previewVisible.value = true
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    importing.value = false
  }
}

async function confirmImport(): Promise<void> {
  previewLoading.value = true
  try {
    const r: ImportResult = await csvApi.importProducts(pendingCsv.value, importMode.value)
    lastImportResult.value = r
    previewVisible.value = false
    const skippedText = r.skipped > 0 ? `，跳过 ${r.skipped} 条` : ''
    if (r.errors.length === 0) {
      ElMessage.success(`导入完成：新增 ${r.created} 条，更新 ${r.updated} 条${skippedText}`)
    } else {
      const lines = r.errors.map((er) => `第${er.row}行：${er.message}`).join('\n')
      await ElMessageBox.alert(
        lines + '\n\n可在列表页点击"导出失败行"下载失败明细 CSV。',
        `导入完成：新增 ${r.created} 条，更新 ${r.updated} 条${skippedText}，失败 ${r.errors.length} 条`,
        { type: 'warning' }
      )
    }
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    previewLoading.value = false
  }
}

onMounted(() => {
  void load()
  void loadAttrDict()
})
onActivated(load)

// ── P3：批量修改 ──
const selectedRows = ref<Product[]>([])
const bulkVisible = ref(false)
const bulkSaving = ref(false)
const bulkForm = reactive({
  retail_price: null as number | null,
  trade_price: null as number | null,
  purchase_price: null as number | null,
  min_stock: null as number | null,
  max_stock: null as number | null,
  shelf_no: '' as string
})

function onSelectionChange(rows: Product[]): void {
  selectedRows.value = rows
}

function openBulkEdit(): void {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选要修改的商品')
    return
  }
  bulkForm.retail_price = null
  bulkForm.trade_price = null
  bulkForm.purchase_price = null
  bulkForm.min_stock = null
  bulkForm.max_stock = null
  bulkForm.shelf_no = ''
  bulkVisible.value = true
}

function buildBulkPatch(): BulkUpdatePatch {
  const patch: Record<string, number | string | undefined> = {}
  if (bulkForm.retail_price !== null) patch['retail_price'] = bulkForm.retail_price
  if (bulkForm.trade_price !== null) patch['trade_price'] = bulkForm.trade_price
  if (bulkForm.purchase_price !== null) patch['purchase_price'] = bulkForm.purchase_price
  if (bulkForm.min_stock !== null) patch['min_stock'] = bulkForm.min_stock
  if (bulkForm.max_stock !== null) patch['max_stock'] = bulkForm.max_stock
  if (bulkForm.shelf_no.trim() !== '') patch['shelf_no'] = bulkForm.shelf_no.trim()
  return patch as BulkUpdatePatch
}

async function submitBulkEdit(): Promise<void> {
  const patch = buildBulkPatch()
  if (Object.keys(patch).length === 0) {
    ElMessage.warning('请至少填写一个要修改的字段')
    return
  }
  const ids = selectedRows.value.map((r) => r.id!).filter((v) => typeof v === 'number')
  try {
    await ElMessageBox.confirm(
      `将批量修改 ${ids.length} 个商品，仅填写的字段生效，是否继续？`,
      '批量修改',
      { type: 'warning' }
    )
  } catch {
    return
  }
  bulkSaving.value = true
  try {
    const r = await productApi.bulkUpdate(ids, patch)
    ElMessage.success(`已批量修改 ${r.updated} 个商品`)
    bulkVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    bulkSaving.value = false
  }
}
</script>

<template>
  <div class="product-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">商品档案</h3>
        <div class="actions">
          <el-input
            v-model="shelfFilter"
            placeholder="货架号"
            clearable
            style="width: 120px; margin-right: 8px"
            @keyup.enter="search"
            @clear="search"
          />
          <el-input
            v-model="keyword"
            placeholder="搜索编码 / 名称 / 条码"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
          <el-select v-model="filterAttrId" filterable clearable placeholder="按属性筛选" style="width: 140px">
            <el-option v-for="a in attrDict" :key="a.id" :label="a.name" :value="a.id ?? 0" />
          </el-select>
          <el-select
            v-if="filterAttrOptions().length > 0"
            v-model="filterAttrValue"
            filterable
            allow-create
            clearable
            placeholder="属性值"
            style="width: 120px"
            @change="addAttrFilter"
          >
            <el-option v-for="opt in filterAttrOptions()" :key="opt" :label="opt" :value="opt" />
          </el-select>
          <el-input v-else v-model="filterAttrValue" placeholder="属性值" clearable style="width: 120px" @keyup.enter="addAttrFilter" @clear="addAttrFilter" />
          <el-tag
            v-for="(val, key) in attrFilters"
            :key="key"
            closable
            size="small"
            style="margin-right: 4px"
            @close="removeAttrFilter(String(key))"
          >{{ attrDict.find((a) => String(a.id) === String(key))?.name ?? key }}: {{ val }}</el-tag>
          <el-button v-if="hasPermission('data.import')" :loading="importing" @click="pickImport">导入 CSV</el-button>
          <!-- S 级：纯前端 Blob 下载模板（不经主进程对话框） -->
          <el-button v-if="hasPermission('data.import')" @click="downloadImportTemplate">下载模板</el-button>
          <!-- S 级：导出最近一次导入的失败行明细 CSV -->
          <el-button
            v-if="hasPermission('data.import') && lastImportResult && lastImportResult.errors.length > 0"
            @click="downloadFailedRows"
          >导出失败行</el-button>
          <el-button v-if="hasPermission('data.export')" :loading="exporting" @click="doExport()">导出 CSV</el-button>
          <el-button v-if="hasPermission('product.edit')" type="warning" plain @click="openBulkEdit">
            批量修改{{ selectedRows.length > 0 ? `(${selectedRows.length})` : '' }}
          </el-button>
          <el-button type="primary" @click="router.push('/product/edit')">新增商品</el-button>
        </div>
      </div>
      <input ref="importInput" type="file" accept=".csv,text/csv" hidden @change="onImportFile" />

      <el-table v-loading="loading" :data="list" stripe class="table" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="42" />
        <el-table-column prop="code" label="编码" width="130" />
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column prop="spec" label="规格" width="120" />
        <el-table-column prop="base_unit" label="单位" width="80" />
        <el-table-column label="图片" width="70">
          <template #default="{ row }">
            <el-image
              v-if="firstImage(row)"
              :src="firstImage(row)"
              fit="cover"
              class="list-thumb"
              :preview-src-list="[firstImage(row)!]"
              preview-teleported
            />
            <span v-else class="muted-hint">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="shelf_no" label="货架号" width="100" />
        <el-table-column label="零售价" width="90" align="right">
          <template #default="{ row }">{{ fmt(row.retail_price) }}</template>
        </el-table-column>
        <el-table-column label="批发价" width="90" align="right">
          <template #default="{ row }">{{ fmt(row.trade_price) }}</template>
        </el-table-column>
        <el-table-column label="进货价" width="90" align="right">
          <template #default="{ row }">{{ fmt(row.purchase_price) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="!row.disabled" type="success" size="small">启用</el-tag>
            <el-tag v-else type="info" size="small">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/product/edit/${row.id}`)">
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

    <el-dialog v-model="previewVisible" title="导入预览" width="720px" :close-on-click-modal="false">
      <div v-loading="previewLoading">
        <el-alert
          v-if="preview && preview.errors.length > 0"
          type="warning"
          :closable="false"
          class="preview-alert"
        >
          <p v-for="er in preview.errors" :key="er.row">第{{ er.row }}行：{{ er.message }}</p>
        </el-alert>
        <p v-if="preview" class="preview-summary">
          共 {{ preview.lines.length }} 行有效：将<b>新建 {{ preview.willCreate }}</b> 条、<b>更新 {{ preview.willUpdate }}</b> 条{{ preview.errors.length ? `，失败 ${preview.errors.length} 条（将跳过）` : '' }}。
          更新仅覆盖 CSV 中有值的列，空列保留原值。
        </p>
        <!-- S 级：更新策略——编码已存在时跳过或覆盖（编码永不覆盖） -->
        <div v-if="preview" class="import-mode-row">
          <span>更新策略：</span>
          <el-radio-group v-model="importMode">
            <el-radio value="update">覆盖更新（默认，覆盖价格/单位等可变字段）</el-radio>
            <el-radio value="skip">跳过已存在编码</el-radio>
          </el-radio-group>
        </div>
        <el-table :data="preview?.lines ?? []" size="small" max-height="360">
          <el-table-column prop="row" label="行" width="55" />
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column prop="base_unit" label="单位" width="70" />
          <el-table-column label="零售价" width="85" align="right">
            <template #default="{ row }">{{ row.retail_price.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="进价" width="85" align="right">
            <template #default="{ row }">{{ row.purchase_price.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-tag :type="row.existing_id ? 'warning' : 'success'" size="small">
                {{ row.existing_id ? '更新' : '新建' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="previewLoading"
          :disabled="!preview || (preview.willCreate + preview.willUpdate === 0)"
          @click="confirmImport"
        >
          确认导入
        </el-button>
      </template>
    </el-dialog>

    <!-- P3：批量修改弹窗（仅填写的字段生效） -->
    <el-dialog v-model="bulkVisible" title="批量修改商品" width="480px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        已选 {{ selectedRows.length }} 个商品；仅填写的字段会被修改，留空的字段保持原值。
      </el-alert>
      <el-form label-width="90px">
        <el-form-item label="零售价">
          <el-input-number v-model="bulkForm.retail_price" :min="0" :precision="2" :controls="false" placeholder="留空不修改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="批发价">
          <el-input-number v-model="bulkForm.trade_price" :min="0" :precision="2" :controls="false" placeholder="留空不修改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="进货价">
          <el-input-number v-model="bulkForm.purchase_price" :min="0" :precision="2" :controls="false" placeholder="留空不修改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="库存下限">
          <el-input-number v-model="bulkForm.min_stock" :min="0" :controls="false" placeholder="留空不修改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="库存上限">
          <el-input-number v-model="bulkForm.max_stock" :min="0" :controls="false" placeholder="留空不修改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="货架号">
          <el-input v-model="bulkForm.shelf_no" maxlength="30" placeholder="留空不修改" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bulkVisible = false">取消</el-button>
        <el-button type="primary" :loading="bulkSaving" @click="submitBulkEdit">确定修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.product-list {
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
.preview-summary {
  margin: 0 0 8px;
  color: var(--el-text-color-regular);
}
.preview-alert p {
  margin: 2px 0;
}

.list-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
}
.muted-hint {
  color: var(--el-text-color-secondary);
}
.import-mode-row {
  margin: 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
