<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { docApi } from '../../api/doc'
import { printApi } from '../../api/print'
import { productApi } from '../../api/product'
import { attachmentApi, type AttachmentRow } from '../../api/attachment'
import { hasPermission } from '../../stores/auth'
import type { DocItemRow, DocRow, DocType } from '../../../../shared/types/doc'
import { DOC_A4_PRINTABLE, DOC_TYPE_LABELS } from '../../../../shared/types/doc'

const docTypeLabels: Record<DocType, string> = DOC_TYPE_LABELS

const DOC_TYPES = Object.keys(docTypeLabels) as DocType[]

const typeFilter = ref<DocType | null>(null)
const keyword = ref('')
const partnerKeyword = ref('')
const dateRange = ref<[string, string] | null>(null)
const loading = ref(false)
const list = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const detailVisible = ref(false)
const detailDoc = ref<DocRow | null>(null)
const detailItems = ref<DocItemRow[]>([])
const productNames = ref<Record<number, string>>({})
/** 当前详情单的红冲单（0 或 1 张） */
const detailReversal = ref<DocRow | null>(null)
/** 已被红冲过的单据 id 集合（列表页标记用） */
const reversedIds = ref<Set<number>>(new Set())

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await docApi.query({
      page: page.value,
      pageSize: pageSize.value,
      type: typeFilter.value ?? undefined,
      keyword: keyword.value || undefined,
      partner_keyword: partnerKeyword.value || undefined,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1]
    })
    list.value = r.items
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

function fmt(n: number): string {
  return n.toFixed(2)
}

function typeName(t: DocType): string {
  return docTypeLabels[t] ?? t
}

function printable(row: DocRow): boolean {
  return DOC_A4_PRINTABLE.has(row.type)
}

async function viewDetail(row: DocRow): Promise<void> {
  try {
    const d = await docApi.getDetail(row.id)
    detailDoc.value = d.doc
    detailItems.value = d.items
    detailVisible.value = true
    detailReversal.value = null
    void loadAttachments(row.id)
    void docApi.reversals(row.id).then((revs) => {
      detailReversal.value = revs[0] ?? null
    })
    void loadProductNames(d.items)
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

/** 红冲当前详情单：二次确认（需输入单号确认）后生成负向镜像单 */
const reversing = ref(false)
async function reverseDoc(): Promise<void> {
  const doc = detailDoc.value
  if (!doc || doc.status !== 'done' || detailReversal.value) return
  try {
    await ElMessageBox.prompt(
      `将为单据 ${doc.no}（${typeName(doc.type)}，金额 ${fmt(doc.total_amount)}）生成全额负向红冲单，并回退库存/资金。此操作不可撤销。请输入单号 ${doc.no} 确认：`,
      '红冲确认',
      { confirmButtonText: '确认红冲', cancelButtonText: '取消', inputPattern: new RegExp(`^${doc.no}$`), inputErrorMessage: `请输入完整单号 ${doc.no}` }
    )
  } catch {
    return
  }
  reversing.value = true
  try {
    const rev = await docApi.reverse(doc.id)
    ElMessage.success(`已生成红冲单 ${rev.no}`)
    detailReversal.value = rev
    reversedIds.value = new Set([...reversedIds.value, doc.id])
    void load()
  } catch (e) {
    ElMessage.error(`红冲失败：${(e as Error).message}`)
  } finally {
    reversing.value = false
  }
}

async function loadProductNames(items: DocItemRow[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.product_id))]
  for (const pid of ids) {
    if (productNames.value[pid]) continue
    try {
      const p = await productApi.get(pid)
      productNames.value[pid] = p ? `${p.code} ${p.name}` : `#${pid}`
    } catch {
      productNames.value[pid] = `#${pid}`
    }
  }
}

function productName(item: DocItemRow): string {
  return productNames.value[item.product_id] ?? `#${item.product_id}`
}

const printingA4 = ref(false)
const canPrintA4 = computed(() => detailDoc.value !== null && printable(detailDoc.value))

// ── M 级功能：单据图片附件（离线拍照留证） ──
const canAttach = hasPermission('doc.attachment')
const canReview = hasPermission('doc.viewAll')

// P2：直过账单据补审核（管理标记，不回滚账务）
const reviewing = ref(false)
async function reviewDoc(): Promise<void> {
  const doc = detailDoc.value
  if (!doc) return
  try {
    await ElMessageBox.confirm(
      `将为单据 ${doc.no} 补充审核标记（不影响已过账的库存/资金），确认？`,
      '补审核确认',
      { type: 'info', confirmButtonText: '确认审核', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  reviewing.value = true
  try {
    const updated = await docApi.review(doc.id)
    detailDoc.value = updated
    ElMessage.success('审核标记已保存')
    void load()
  } catch (e) {
    ElMessage.error(`审核失败：${(e as Error).message}`)
  } finally {
    reviewing.value = false
  }
}
const attachments = ref<AttachmentRow[]>([])
const uploadInput = ref<HTMLInputElement | null>(null)
const previewVisible = ref(false)
const previewSrc = ref('')
const previewName = ref('')

async function loadAttachments(docId: number): Promise<void> {
  attachments.value = []
  if (!canAttach) return
  try {
    attachments.value = await attachmentApi.listByDoc(docId)
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function onPickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !detailDoc.value) return
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error('图片过大：请选择 10MB 以内的图片')
    return
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  try {
    await attachmentApi.save({ doc_id: detailDoc.value.id, file_name: file.name, data })
    ElMessage.success('附件已保存')
    void loadAttachments(detailDoc.value.id)
  } catch (e) {
    ElMessage.error(`保存附件失败：${(e as Error).message}`)
  }
}

async function previewAttachment(att: AttachmentRow): Promise<void> {
  try {
    const r = await attachmentApi.read(att.id)
    const mime = att.file_path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    previewSrc.value = `data:${mime};base64,${r.data}`
    previewName.value = r.file_name
    previewVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function removeAttachment(att: AttachmentRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除附件「${att.file_name}」？此操作不可撤销。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await attachmentApi.remove(att.id)
    ElMessage.success('附件已删除')
    if (detailDoc.value) void loadAttachments(detailDoc.value.id)
  } catch (e) {
    ElMessage.error(`删除附件失败：${(e as Error).message}`)
  }
}

function thumbSrc(att: AttachmentRow): string {
  // 缩略图直接读原图（离线小图足够）；点击再经 read 拉全量预览
  return `#thumb-${att.id}`
}

async function printA4(): Promise<void> {
  if (!detailDoc.value) return
  printingA4.value = true
  try {
    const path = await printApi.a4Pdf(detailDoc.value.id)
    ElMessage.success(`已保存：${path}`)
  } catch (e) {
    ElMessage.error(`打印失败：${(e as Error).message}`)
  } finally {
    printingA4.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="doc-search">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">单据查询</h3>
        <div class="actions">
          <el-select
            v-model="typeFilter"
            clearable
            placeholder="全部类型"
            style="width: 160px"
            @change="search"
          >
            <el-option v-for="t in DOC_TYPES" :key="t" :label="typeName(t)" :value="t" />
          </el-select>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
            @change="search"
          />
          <el-input
            v-model="partnerKeyword"
            placeholder="往来单位名称或编码"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-input
            v-model="keyword"
            placeholder="搜索单号"
            clearable
            class="search"
            @keyup.enter="search"
            @clear="search"
          >
            <template #append>
              <el-button @click="search">搜索</el-button>
            </template>
          </el-input>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe class="table">
        <el-table-column prop="no" label="单号" width="190" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type.startsWith('purchase') ? 'warning' : 'info'">
              {{ typeName(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column label="往来单位" min-width="160">
          <template #default="{ row }">{{ row.partner_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="总金额" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
        </el-table-column>
        <el-table-column label="红冲" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.reversal_of || reversedIds.has(row.id)" type="warning" size="small">红冲单</el-tag>
            <el-tag v-else-if="row.remark?.startsWith('红冲')" type="warning" size="small">红冲单</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />
    </el-card>

    <el-dialog v-model="detailVisible" title="单据详情" width="760px">
      <template v-if="detailDoc">
        <el-descriptions :column="3" border size="small" class="desc">
          <el-descriptions-item label="单号">{{ detailDoc.no }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ typeName(detailDoc.type) }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detailDoc.date }}</el-descriptions-item>
          <el-descriptions-item label="往来单位">{{ detailDoc.partner_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="总金额">{{ fmt(detailDoc.total_amount) }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ detailDoc.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="审核状态">
            <el-tag v-if="detailDoc.reviewed_by" type="success" size="small">已审核：{{ detailDoc.reviewed_by }}</el-tag>
            <el-tag v-else type="info" size="small">未审核</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="红冲状态">
            <el-tag v-if="detailReversal" type="danger" size="small">已被红冲：{{ detailReversal.no }}</el-tag>
            <el-tag v-else-if="detailDoc.reversal_of" type="warning" size="small">红冲单</el-tag>
            <el-tag v-else-if="detailDoc.status === 'done'" type="success" size="small">正常</el-tag>
            <el-tag v-else size="small">草稿</el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="detailItems" stripe size="small">
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">{{ productName(row) }}</template>
          </el-table-column>
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column prop="batch_no" label="批次号" width="100" />
          <el-table-column prop="qty" label="数量" width="90" align="right" />
          <el-table-column label="单价" width="90" align="right">
            <template #default="{ row }">{{ fmt(row.price) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.amount) }}</template>
          </el-table-column>
        </el-table>

        <!-- 图片附件区（M 级功能：离线拍照留证） -->
        <div v-if="canAttach" class="attachments">
          <div class="att-head">
            <strong>图片附件</strong>
            <input ref="uploadInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" style="display: none" @change="onPickFile" />
            <el-button size="small" type="primary" :disabled="!detailDoc" @click="uploadInput?.click()">上传图片</el-button>
          </div>
          <div v-if="attachments.length" class="att-list">
            <div v-for="att in attachments" :key="att.id" class="att-item">
              <el-image
                :src="thumbSrc(att)"
                :preview-src-list="[thumbSrc(att)]"
                hide-on-click-modal
                class="att-thumb"
                @click="void previewAttachment(att)"
              >
                <template #error><div class="att-err">{{ att.file_name }}</div></template>
              </el-image>
              <div class="att-meta" :title="att.file_name">{{ att.file_name }}</div>
              <el-button link type="danger" size="small" @click="removeAttachment(att)">删除</el-button>
            </div>
          </div>
          <el-empty v-else description="暂无图片附件" :image-size="48" />
        </div>
      </template>
      <template #footer>
        <el-button
          v-if="detailDoc?.status === 'done' && !detailReversal && !detailDoc.reversal_of"
          type="danger"
          :loading="reversing"
          @click="reverseDoc"
        >红冲</el-button>
        <el-button
          v-if="canReview && detailDoc?.status === 'done' && !detailDoc.reviewed_by"
          type="primary"
          :loading="reviewing"
          @click="reviewDoc"
        >补审核</el-button>
        <el-button v-if="canPrintA4" :loading="printingA4" @click="printA4">打印 A4</el-button>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="previewName" width="640px" append-to-body>
      <img v-if="previewSrc" :src="previewSrc" class="preview-img" alt="附件预览" />
    </el-dialog>
  </div>
</template>

<style scoped>
.doc-search .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.doc-search .title {
  margin: 0;
}
.doc-search .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.doc-search .search {
  width: 220px;
}
.doc-search .pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.doc-search .desc {
  margin-bottom: 12px;
}
.attachments {
  margin-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
}
.att-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.att-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.att-item {
  width: 96px;
  text-align: center;
}
.att-thumb {
  width: 96px;
  height: 72px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.att-err {
  font-size: 11px;
  padding: 8px 4px;
  color: var(--el-text-color-secondary);
}
.att-meta {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 4px 0;
}
.preview-img {
  width: 100%;
  object-fit: contain;
}
</style>
