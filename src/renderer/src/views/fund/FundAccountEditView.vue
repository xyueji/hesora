<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fundApi } from '../../api/fund'
import { FUND_ACCOUNT_TYPES, type FundAccount } from '../../../../shared/types/fund'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<FundAccount>({
  code: '',
  name: '',
  type: 'cash',
  opening_balance: 0,
  remark: ''
})

const saving = ref(false)

async function load(): Promise<void> {
  if (!isEdit.value) return
  try {
    const f = await fundApi.get(id.value!)
    if (!f) {
      ElMessage.error('资金账户不存在')
      return
    }
    form.value = f
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
    const payload: Omit<FundAccount, 'id'> = { ...form.value }
    if (isEdit.value) await fundApi.update(id.value!, payload)
    else await fundApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/account/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="fund-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑资金账户' : '新增资金账户' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/account/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="110px" class="form">
        <el-form-item label="编码">
          <el-input v-model="form.code" :disabled="isEdit" placeholder="留空自动生成" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="账户名称" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="form.type">
            <el-option
              v-for="t in FUND_ACCOUNT_TYPES"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="期初余额">
          <el-input-number v-model="form.opening_balance" :precision="2" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.fund-edit {
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
