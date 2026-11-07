<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { categoryApi, type CategoryRow } from '../../api/category'

type Kind = 'income' | 'expense'

const kind = ref<Kind | ''>('')
const rows = ref<CategoryRow[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref<CategoryRow | null>(null)
const form = ref<{ name: string; kind: Kind }>({ name: '', kind: 'expense' })

async function load(): Promise<void> {
  loading.value = true
  try {
    rows.value = await categoryApi.list({ include_disabled: true, kind: kind.value || undefined })
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editing.value = null
  form.value = { name: '', kind: kind.value || 'expense' }
  dialogVisible.value = true
}

function openEdit(row: CategoryRow): void {
  editing.value = row
  form.value = { name: row.name, kind: row.kind }
  dialogVisible.value = true
}

async function save(): Promise<void> {
  const name = form.value.name.trim()
  if (!name) {
    ElMessage.warning('请输入科目名称')
    return
  }
  try {
    if (editing.value) {
      await categoryApi.update(editing.value.id, { name, kind: form.value.kind })
      ElMessage.success('科目已更新')
    } else {
      await categoryApi.create({ name, kind: form.value.kind })
      ElMessage.success('科目已新增')
    }
    dialogVisible.value = false
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function toggleDisabled(row: CategoryRow): Promise<void> {
  try {
    if (row.disabled) {
      await categoryApi.enable(row.id)
      ElMessage.success('已启用')
    } else {
      await categoryApi.disable(row.id)
      ElMessage.success('已停用')
    }
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function remove(row: CategoryRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除科目「${row.name}」？删除后不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await categoryApi.remove(row.id)
    ElMessage.success('已删除')
    void load()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function kindLabel(row: CategoryRow): string {
  return row.kind === 'income' ? '收入' : '支出'
}

onMounted(() => void load())
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="cat-header">
        <strong>收支科目</strong>
        <div class="cat-actions">
          <el-select v-model="kind" clearable placeholder="全部类型" style="width: 120px" @change="load">
            <el-option label="收入" value="income" />
            <el-option label="支出" value="expense" />
          </el-select>
          <el-button type="primary" @click="openCreate">新增科目</el-button>
        </div>
      </div>
    </template>
    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column label="科目名称" prop="name" min-width="200" />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag :type="row.kind === 'income' ? 'success' : 'warning'">{{ kindLabel(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.disabled ? 'info' : 'primary'">{{ row.disabled ? '已停用' : '启用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.disabled ? 'success' : 'warning'" @click="toggleDisabled(row)">
            {{ row.disabled ? '启用' : '停用' }}
          </el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无科目，点击「新增科目」创建</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑科目' : '新增科目'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="科目名称">
          <el-input v-model="form.name" maxlength="50" placeholder="如：水电费、利息收入" @keyup.enter="save" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.kind">
            <el-radio value="income">收入</el-radio>
            <el-radio value="expense">支出</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.cat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cat-actions {
  display: flex;
  gap: 12px;
}
</style>
