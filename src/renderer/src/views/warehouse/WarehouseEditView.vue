<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { warehouseApi } from '../../api/warehouse'
import type { Warehouse } from '../../../../shared/types/warehouse'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<Warehouse>({
  code: '',
  name: '',
  is_default: false,
  remark: ''
})

const saving = ref(false)

async function load(): Promise<void> {
  if (!isEdit.value) return
  try {
    const w = await warehouseApi.get(id.value!)
    if (!w) {
      ElMessage.error('仓库不存在')
      return
    }
    form.value = w
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    ElMessage.warning('名称为必填项')
    return
  }
  saving.value = true
  try {
    const payload: Omit<Warehouse, 'id'> = { ...form.value }
    if (isEdit.value) await warehouseApi.update(id.value!, payload)
    else await warehouseApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/warehouse/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="warehouse-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑仓库' : '新增仓库' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/warehouse/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="110px" class="form">
        <el-form-item label="编码">
          <el-input v-model="form.code" :disabled="isEdit" placeholder="留空自动生成" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="仓库名称" />
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="form.is_default" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.warehouse-edit {
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
  max-width: 640px;
}
</style>
