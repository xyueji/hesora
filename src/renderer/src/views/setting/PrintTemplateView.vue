<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { printTemplateApi, type PrintTemplate } from '../../api/print'

/** 打印模板开关（与 shared/print/templates 的 PrintTemplateOptions 对应）。 */
interface TemplateOptions {
  showShopHeader?: boolean
  showAmountColumn?: boolean
  showRemark?: boolean
  showPaymentMethod?: boolean
  showFooter?: boolean
}

const SWITCH_FIELDS: Array<{ key: keyof TemplateOptions; label: string; kinds: Array<'receipt' | 'a4'> }> = [
  { key: 'showShopHeader', label: '显示店铺头', kinds: ['receipt', 'a4'] },
  { key: 'showAmountColumn', label: '显示金额列', kinds: ['a4'] },
  { key: 'showRemark', label: '显示备注', kinds: ['receipt', 'a4'] },
  { key: 'showPaymentMethod', label: '显示收款方式', kinds: ['receipt'] },
  { key: 'showFooter', label: '显示页脚', kinds: ['receipt'] }
]

const loading = ref(false)
const saving = ref(false)
const list = ref<PrintTemplate[]>([])
const editing = ref(false)
const form = reactive({
  id: undefined as number | undefined,
  name: '',
  kind: 'receipt' as 'receipt' | 'a4',
  switches: {
    showShopHeader: true,
    showAmountColumn: true,
    showRemark: true,
    showPaymentMethod: true,
    showFooter: true
  } as Required<TemplateOptions>
})

function parseOptions(content: string): Required<TemplateOptions> {
  const def: Required<TemplateOptions> = {
    showShopHeader: true, showAmountColumn: true, showRemark: true, showPaymentMethod: true, showFooter: true
  }
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      for (const f of SWITCH_FIELDS) {
        if (typeof obj[f.key] === 'boolean') def[f.key] = obj[f.key] as boolean
      }
    }
  } catch {
    /* 用默认 */
  }
  return def
}

function switchKeysOf(kind: 'receipt' | 'a4'): Array<keyof TemplateOptions> {
  return SWITCH_FIELDS.filter((f) => f.kinds.includes(kind)).map((f) => f.key)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await printTemplateApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  form.id = undefined
  form.name = ''
  form.kind = 'receipt'
  form.switches = { showShopHeader: true, showAmountColumn: true, showRemark: true, showPaymentMethod: true, showFooter: true }
  editing.value = true
}

function openEdit(row: PrintTemplate): void {
  form.id = row.id
  form.name = row.name
  form.kind = row.kind
  form.switches = parseOptions(row.content)
  editing.value = true
}

async function save(): Promise<void> {
  if (saving.value) return
  if (!form.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  saving.value = true
  try {
    const content: Record<string, boolean> = {}
    for (const key of switchKeysOf(form.kind)) content[key] = form.switches[key]
    await printTemplateApi.save({ id: form.id, name: form.name.trim(), kind: form.kind, content: JSON.stringify(content) })
    ElMessage.success('模板已保存')
    editing.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function setDefault(row: PrintTemplate): Promise<void> {
  try {
    await printTemplateApi.setDefault(row.id)
    ElMessage.success(`已将「${row.name}」设为默认`)
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function remove(row: PrintTemplate): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除模板「${row.name}」？`, '删除模板', { type: 'warning' })
  } catch {
    return
  }
  try {
    await printTemplateApi.remove(row.id)
    ElMessage.success('模板已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="print-template-view">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">打印模板</h3>
        <el-button type="primary" @click="openCreate">新建模板</el-button>
      </div>
      <el-table :data="list" stripe border>
        <el-table-column prop="name" label="模板名称" min-width="160" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'receipt' ? 'success' : 'primary'">
              {{ row.kind === 'receipt' ? '小票' : 'A4 单据' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="默认" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.is_default === 1" type="warning" size="small">默认</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.is_default !== 1" link type="warning" @click="setDefault(row)">设为默认</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editing" :title="form.id === undefined ? '新建模板' : '编辑模板'" width="480px">
      <el-form label-width="100px">
        <el-form-item label="模板名称">
          <el-input v-model="form.name" placeholder="如：门店小票" maxlength="50" />
        </el-form-item>
        <el-form-item label="模板类型">
          <el-radio-group v-model="form.kind" :disabled="form.id !== undefined">
            <el-radio value="receipt">小票</el-radio>
            <el-radio value="a4">A4 单据</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-for="f in SWITCH_FIELDS.filter((x) => x.kinds.includes(form.kind))" :key="f.key" :label="f.label">
          <el-switch v-model="form.switches[f.key]" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  margin: 0;
}
</style>
