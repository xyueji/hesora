<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { customerApi } from '../../api/customer'
import type { Customer } from '../../../../shared/types/customer'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<Customer>({
  code: '',
  name: '',
  contact: '',
  phone: '',
  address: '',
  price_level: '',
  opening_receivable: 0,
  credit_limit: null,
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
    const c = await customerApi.get(id.value!)
    if (!c) {
      ElMessage.error('客户不存在')
      return
    }
    form.value = c
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
    const payload: Omit<Customer, 'id'> = { ...form.value }
    if (isEdit.value) await customerApi.update(id.value!, payload)
    else await customerApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/customer/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="customer-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑客户' : '新增客户' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/customer/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="110px" class="form">
        <div class="section-title">基本信息</div>
        <div class="grid">
          <el-form-item label="编码" required>
            <el-input v-model="form.code" :disabled="isEdit" placeholder="客户编码" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="客户名称" />
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
          <el-form-item label="价格等级">
            <el-input v-model="form.price_level" placeholder="如：零售 / 批发 / VIP" />
          </el-form-item>
          <!-- [4] 邮箱、[8] 分类（S 级功能批次 B） -->
          <el-form-item label="邮箱">
            <el-input v-model="form.email" placeholder="电子邮箱" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="form.category" list="customer-category-options" placeholder="普通 / 批发 / VIP" />
            <datalist id="customer-category-options">
              <option value="普通" />
              <option value="批发" />
              <option value="VIP" />
            </datalist>
          </el-form-item>
        </div>

        <div class="section-title">期初与信用</div>
        <div class="grid">
          <el-form-item label="期初应收">
            <el-input-number v-model="form.opening_receivable" :precision="2" />
          </el-form-item>
          <el-form-item label="信用额度">
            <el-input-number v-model="form.credit_limit" :precision="2" :min="0" :value-on-clear="null" />
          </el-form-item>
        </div>

        <div class="section-title">备注</div>
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.customer-edit {
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
