<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productApi } from '../../api/product'
import { csvApi, readCsvFile } from '../../api/csv'
import { hasPermission } from '../../stores/auth'
import type { ImportResult, ProductPreview } from '../../api/csv'
import type { Product } from '../../../../shared/types/product'

const router = useRouter()

const keyword = ref('')
const loading = ref(false)
const list = ref<Product[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await productApi.query({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined
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

const importing = ref(false)
const exporting = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const previewVisible = ref(false)
const previewLoading = ref(false)
const preview = ref<ProductPreview | null>(null)
const pendingCsv = ref('')

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
    const r: ImportResult = await csvApi.importProducts(pendingCsv.value)
    previewVisible.value = false
    if (r.errors.length === 0) {
      ElMessage.success(`导入完成：新增 ${r.created} 条，更新 ${r.updated} 条`)
    } else {
      const lines = r.errors.map((er) => `第${er.row}行：${er.message}`).join('\n')
      await ElMessageBox.alert(lines, `导入完成：新增 ${r.created} 条，更新 ${r.updated} 条，失败 ${r.errors.length} 条`, {
        type: 'warning'
      })
    }
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    previewLoading.value = false
  }
}

onMounted(load)
onActivated(load)
</script>

<template>
  <div class="product-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">商品档案</h3>
        <div class="actions">
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
          <el-button v-if="hasPermission('data.import')" :loading="importing" @click="pickImport">导入 CSV</el-button>
          <el-button v-if="hasPermission('data.import') && hasPermission('data.export')" :loading="exporting" @click="doExport('product-template')">下载模板</el-button>
          <el-button v-if="hasPermission('data.export')" :loading="exporting" @click="doExport()">导出 CSV</el-button>
          <el-button type="primary" @click="router.push('/product/edit')">新增商品</el-button>
        </div>
      </div>
      <input ref="importInput" type="file" accept=".csv,text/csv" hidden @change="onImportFile" />

      <el-table v-loading="loading" :data="list" stripe class="table">
        <el-table-column prop="code" label="编码" width="130" />
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column prop="spec" label="规格" width="120" />
        <el-table-column prop="base_unit" label="单位" width="80" />
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
</style>
