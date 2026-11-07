<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import brandIcon from '../assets/hesora.svg'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api/auth'
import { settingApi } from '../api/setting'
import { setSession } from '../stores/auth'

const router = useRouter()
const loading = ref(false)
const form = reactive({ username: '', password: '', confirm: '' })
const setup = ref<{ required: boolean; username?: string }>({ required: false })
const ready = ref(false)

onMounted(async () => {
  try {
    setup.value = await authApi.setupStatus()
    if (setup.value.required) form.username = setup.value.username ?? 'admin'
    ready.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
})

async function submit() {
  if (!form.username.trim() || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  if (setup.value.required && form.confirm !== form.password) {
    ElMessage.warning('两次密码不一致')
    return
  }
  loading.value = true
  try {
    const user = await (setup.value.required ? authApi.setup : authApi.login)(form.username.trim(), form.password)
    if (!user) {
      ElMessage.error('用户名或密码错误，或账号已停用')
      return
    }
    setSession(user)
    ElMessage.success(`欢迎，${user.username}`)
    // 首次使用（guide.show 未关闭）→ 先看新手引导
    try {
      const show = await settingApi.get('guide.show')
      const completed = await settingApi.get('guide.welcome_completed')
      if (show !== '0' && completed !== '1') {
        void router.push('/guide')
        return
      }
    } catch {
      /* 读设置失败则正常进首页 */
    }
    void router.push('/')
  } catch (e) {
    ElMessage.error((e as Error).message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-intro"><img :src="brandIcon" alt="禾序" /><div class="brand-eyebrow">HESORA INVENTORY</div><h1>货有数，账有序。</h1><p>让每一笔生意清楚有据。<br />进货、销售、库存与往来，在这里有序连接。</p><span>Windows 本地进销存</span></section>
    <el-card class="login-card">
      <template #header>
        <div class="login-title">{{ setup.required ? '设置管理员' : '登录禾序进销存' }}</div>
      </template>
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="用户名" :disabled="Boolean(setup.username)" autofocus data-test="login-username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="密码"
            data-test="login-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item v-if="setup.required" label="确认密码">
          <el-input v-model="form.confirm" type="password" placeholder="请再次输入密码" data-test="login-confirm-password" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" :disabled="!ready" style="width: 100%" data-test="login-submit" @click="submit">
            {{ setup.required ? '创建并登录' : '登录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
}

.login-card {
  width: 380px;
}

.login-title {
  font-weight: 600;
  text-align: center;
}
</style>
