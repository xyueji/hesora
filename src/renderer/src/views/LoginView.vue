<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api/auth'
import { setSession } from '../stores/auth'

const router = useRouter()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

async function submit() {
  if (!form.username.trim() || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    const user = await authApi.login(form.username.trim(), form.password)
    if (!user) {
      ElMessage.error('用户名或密码错误，或账号已停用')
      return
    }
    setSession(user)
    ElMessage.success(`欢迎，${user.username}`)
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
    <el-card class="login-card">
      <template #header>
        <div class="login-title">进销存管理系统 · 登录</div>
      </template>
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="用户名" autofocus data-test="login-username" />
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
        <el-form-item>
          <el-button type="primary" :loading="loading" style="width: 100%" data-test="login-submit" @click="submit">
            登录
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
