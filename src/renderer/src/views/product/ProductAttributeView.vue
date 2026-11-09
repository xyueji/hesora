<script setup lang="ts">
// P2：商品属性字典管理（颜色→红/蓝 等），商品编辑页引用此字典。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productAttributeApi } from '../../api/product-attribute'
import { hasPermission } from '../../stores/auth'
import type { ProductAttribute } from '../../../../shared/types/product'

const canEdit = hasPermission('product.edit')

const list = ref<ProductAttribute[]>([])
const loading = ref(false)
const visible = ref(false)
const saving = ref(false)

const form = reactive<{ id: number | null; name: string; optionsText: string }>({
  id: null,
  name: '',
  optionsText: ''
})

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await productAttributeApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message || '读取属性字典失败')
  } finally {
    loading.value = false
  }
}

function optionsOf(row: ProductAttribute): string[] {
  try {
    const v = JSON.parse(row.options) as unknown
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function openCreate(): void {
  form.id = null
  form.name = ''
  form.optionsText = ''
  visible.value = true
}

function openEdit(row: ProductAttribute): void {
  form.id = row.id
  form.name = row.name
  form.optionsText = optionsOf(row).join('、')
  visible.value = true
}

async function save(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('属性名不能为空')
    return
  }
  const options = form.optionsText
    .split(/[、,，;；\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  saving.value = true
  try {
    if (form.id === null) {
      await productAttributeApi.create({ name: form.name.trim(), options })
      ElMessage.success('属性已创建')
    } else {
      await productAttributeApi.update(form.id, { name: form.name.trim(), options })
      ElMessage.success('属性已更新')
    }
    visible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: ProductAttribute): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除属性「${row.name}」吗？被商品引用的属性无法删除。`,
      '删除属性',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await productAttributeApi.remove(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">商品属性字典</h3>
        <el-button v-if="canEdit" type="primary" @click="openCreate">新增属性</el-button>
      </div>

      <el-table v-loading="loading" :data="list" border>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="属性名" width="160" />
        <el-table-column label="可选值" min-width="240">
          <template #default="{ row }">
            <el-tag v-for="opt in optionsOf(row)" :key="opt" size="small" style="margin-right: 6px">{{ opt }}</el-tag>
            <span v-if="optionsOf(row).length === 0" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canEdit" label="操作" width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="visible" :title="form.id === null ? '新增属性' : '编辑属性'" width="480px">
      <el-form label-width="80px">
        <el-form-item label="属性名" required>
          <el-input v-model="form.name" maxlength="30" placeholder="如：颜色" />
        </el-form-item>
        <el-form-item label="可选值">
          <el-input
            v-model="form.optionsText"
            type="textarea"
            :rows="3"
            placeholder="用顿号/逗号分隔，如：红、蓝、绿"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.title { margin: 0; }
.muted { color: var(--el-text-color-secondary); }
</style>
