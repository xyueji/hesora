<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { docApi } from '../../api/doc'
import { printApi } from '../../api/print'
import { productApi } from '../../api/product'
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
      </template>
      <template #footer>
        <el-button
          v-if="detailDoc?.status === 'done' && !detailReversal && !detailDoc.reversal_of"
          type="danger"
          :loading="reversing"
          @click="reverseDoc"
        >红冲</el-button>
        <el-button v-if="canPrintA4" :loading="printingA4" @click="printA4">打印 A4</el-button>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
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
</style>
