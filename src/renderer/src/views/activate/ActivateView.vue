<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { licenseApi } from '../../api/license'

const router = useRouter()
const loading = ref(false)
const form = reactive({ code: '' })

const onlineAvailable = ref(false)
const online = ref(false)
// D16（T8 商用闭环）：过期进入本页时提示数据只读语义，而非继续展示 7 天试用文案。
const expired = ref(false)
onMounted(async () => {
  const status = await licenseApi.check().catch(() => null)
  onlineAvailable.value = Boolean(status?.onlineAvailable)
  expired.value = status?.phase === 'expired'
})

async function submit() {
  if (!form.code.trim()) {
    ElMessage.warning('请输入激活码')
    return
  }
  loading.value = true
  try {
    const payload = await (online.value ? licenseApi.activateOnline : licenseApi.activate)(form.code.trim())
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
        <div class="activate-title">禾序进销存 · 软件激活</div>
      </template>
      <el-alert
        :type="expired ? 'warning' : 'info'"
        :closable="false"
        show-icon
        :title="expired ? '试用已结束' : '试用说明'"
        :description="expired
          ? '试用已结束，数据只读——仍可查询/备份，激活后恢复。请向供应商获取激活码完成激活。'
          : '本软件免费试用 7 天（含专业版全部功能），到期后需输入激活码继续使用。请向供应商获取激活码。在线激活绑定本机设备，成功后可离线使用。'"
        style="margin-bottom: 16px"
      />
      <el-form @submit.prevent>
        <el-form-item v-if="onlineAvailable">
          <el-checkbox v-model="online">使用兑换码在线激活</el-checkbox>
        </el-form-item>
        <el-form-item label="激活码">
          <el-input
            v-model="form.code"
            type="textarea"
            :rows="4"
            placeholder="请粘贴完整的授权激活码"
            data-test="activate-code"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" data-test="activate-submit" @click="submit">激活</el-button>
          <a href="https://hesora.xclock.online/buy/" target="_blank" rel="noopener noreferrer" style="margin-left:12px">还没有激活码？去官网购买 →</a>
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
