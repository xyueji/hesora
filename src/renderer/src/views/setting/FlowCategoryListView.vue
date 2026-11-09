<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCategoryApi, type FlowCategoryRow } from '../../api/flow-category'

const list = ref<FlowCategoryRow[]>([])
const loading = ref(false)
const includeDisabled = ref(false)
const kindFilter = ref<'' | 'in' | 'out'>('')

const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', kind: 'in' as 'in' | 'out' })

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await flowCategoryApi.list({
      include_disabled: includeDisabled.value,
      kind: kindFilter.value || undefined
    })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.kind = 'in'
  dialogVisible.value = true
}

function openEdit(row: FlowCategoryRow): void {
  editingId.value = row.id
  form.name = row.name
  form.kind = row.kind
  dialogVisible.value = true
}

async function save(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请输入类别名称')
    return
  }
  try {
    if (editingId.value === null) {
      await flowCategoryApi.create({ name: form.name.trim(), kind: form.kind })
      ElMessage.success('新增成功')
    } else {
      await flowCategoryApi.update(editingId.value, { name: form.name.trim(), kind: form.kind })
      ElMessage.success('保存成功')
    }
    dialogVisible.value = false
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function toggleDisabled(row: FlowCategoryRow): Promise<void> {
  try {
    await (row.disabled ? flowCategoryApi.enable(row.id) : flowCategoryApi.disable(row.id))
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function remove(row: FlowCategoryRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除类别「${row.name}」吗？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await flowCategoryApi.remove(row.id)
    ElMessage.success('删除成功')
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flow-category-list">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">进出类别</h3>
        <div class="actions">
          <el-select v-model="kindFilter" style="width: 120px" @change="load">
            <el-option label="全部方向" value="" />
            <el-option label="入库类" value="in" />
            <el-option label="出库类" value="out" />
          </el-select>
          <el-checkbox v-model="includeDisabled" label="显示已停用" @change="load" />
          <el-button type="primary" @click="openCreate">新增类别</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="类别名称" min-width="180" />
        <el-table-column label="方向" width="110">
          <template #default="{ row }">
            <el-tag :type="row.kind === 'in' ? 'success' : 'warning'">
              {{ row.kind === 'in' ? '入库类' : '出库类' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.disabled ? 'info' : 'success'">{{ row.disabled ? '停用' : '启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link @click="toggleDisabled(row)">{{ row.disabled ? '启用' : '停用' }}</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增类别' : '编辑类别'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="50" placeholder="如：进货 / 领用" />
        </el-form-item>
        <el-form-item label="方向" required>
          <el-radio-group v-model="form.kind">
            <el-radio value="in">入库类</el-radio>
            <el-radio value="out">出库类</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.flow-category-list .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.flow-category-list .title {
  margin: 0;
}
.flow-category-list .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
