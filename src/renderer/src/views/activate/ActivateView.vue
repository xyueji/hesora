<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { licenseApi } from '../../api/license'

const router = useRouter()
const loading = ref(false)
const form = reactive({ code: '' })

async function submit() {
  if (!form.code.trim()) {
    ElMessage.warning('请输入激活码')
    return
  }
  loading.value = true
  try {
    const payload = await licenseApi.activate(form.code.trim())
    ElMessage.success(`激活成功，授权给：${payload.customer}`)
    void router.push('/')
  } catch (e) {
    ElMessage.error((e as Error).message || '激活失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="activate-page">
    <el-card class="activate-card">
      <template #header>
        <div class="activate-title">软件激活</div>
      </template>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="试用说明"
        description="本软件免费试用 15 天，到期后需输入激活码继续使用。激活码与供应商获取，粘贴到下方输入框即可，激活一次永久有效（除非激活码本身带有效期）。本软件完全离线运行，激活不联网。"
        style="margin-bottom: 16px"
      />
      <el-form @submit.prevent>
        <el-form-item label="激活码">
          <el-input
            v-model="form.code"
            type="textarea"
            :rows="4"
            placeholder="ZHJS1.xxxx.yyyy"
            data-test="activate-code"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" data-test="activate-submit" @click="submit">激活</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.activate-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
}

.activate-card {
  width: 560px;
  max-width: 92vw;
}

.activate-title {
  font-weight: 600;
  text-align: center;
  font-size: 18px;
}
</style>
