<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { supplierApi } from '../../api/supplier'
import type { Supplier } from '../../../../shared/types/supplier'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<Supplier>({
  code: '',
  name: '',
  contact: '',
  phone: '',
  address: '',
  opening_payable: 0,
  remark: '',
  // ── S 级功能批次 B：[4] 邮箱、[8] 分类 ──
  email: '',
  category: ''
})

// [4] 简单邮箱格式校验（与服务层一致：非空须含 @ 且两侧非空）
function validEmail(v: string | undefined): boolean {
  const s = (v ?? '').trim()
  if (!s) return true
  const at = s.indexOf('@')
  return at > 0 && at < s.length - 1 && !s.includes(' ')
}

const saving = ref(false)

async function load(): Promise<void> {
  if (!isEdit.value) return
  try {
    const s = await supplierApi.get(id.value!)
    if (!s) {
      ElMessage.error('供应商不存在')
      return
    }
    form.value = s
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function save(): Promise<void> {
  if (!form.value.code.trim() || !form.value.name.trim()) {
    ElMessage.warning('编码、名称为必填项')
    return
  }
  if (!validEmail(form.value.email)) {
    ElMessage.warning('邮箱格式不正确')
    return
  }
  saving.value = true
  try {
    const payload: Omit<Supplier, 'id'> = { ...form.value }
    if (isEdit.value) await supplierApi.update(id.value!, payload)
    else await supplierApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/supplier/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="supplier-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑供应商' : '新增供应商' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/supplier/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="110px" class="form">
        <div class="section-title">基本信息</div>
        <div class="grid">
          <el-form-item label="编码" required>
            <el-input v-model="form.code" :disabled="isEdit" placeholder="供应商编码" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="供应商名称" />
          </el-form-item>
          <el-form-item label="联系人">
            <el-input v-model="form.contact" placeholder="联系人" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="form.phone" placeholder="联系电话" />
          </el-form-item>
          <el-form-item label="地址">
            <el-input v-model="form.address" placeholder="地址" />
          </el-form-item>
          <!-- [4] 邮箱、[8] 分类（S 级功能批次 B） -->
          <el-form-item label="邮箱">
            <el-input v-model="form.email" placeholder="电子邮箱" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="form.category" list="supplier-category-options" placeholder="普通 / 批发 / VIP" />
            <datalist id="supplier-category-options">
              <option value="普通" />
              <option value="批发" />
              <option value="VIP" />
            </datalist>
          </el-form-item>
        </div>

        <div class="section-title">期初</div>
        <div class="grid">
          <el-form-item label="期初应付">
            <el-input-number v-model="form.opening_payable" :precision="2" />
          </el-form-item>
        </div>

        <div class="section-title">备注</div>
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.supplier-edit {
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
</style>
