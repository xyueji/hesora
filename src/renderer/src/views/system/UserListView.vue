<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { roleApi, userApi, type SafeUser } from '../../api/user'
import type { AccessRole } from '../../../../shared/permissions'

const loading = ref(false)
const saving = ref(false)
const users = ref<SafeUser[]>([])
const roles = ref<AccessRole[]>([])
const dialogVisible = ref(false)
const editing = ref<SafeUser | null>(null)
const form = reactive({ username: '', password: '', role: 'cashier' })

async function loadRoles() {
  try {
    roles.value = await roleApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message || '加载角色失败')
  }
}

async function load() {
  loading.value = true
  try {
    users.value = await userApi.query()
  } catch (e) {
    ElMessage.error((e as Error).message || '加载用户失败')
  } finally {
    loading.value = false
  }
}

function roleName(id: string): string {
  return roles.value.find((r) => r.id === id)?.name ?? id
}

function roleDesc(id: string): string {
  const r = roles.value.find((x) => x.id === id)
  if (!r) return ''
  if (r.builtin) return r.id === 'admin' ? '全部权限' : `内置角色 · ${r.permissions.length} 项权限`
  return `自定义角色 · ${r.permissions.length} 项权限`
}

function openCreate() {
  editing.value = null
  form.username = ''
  form.password = ''
  form.role = 'cashier'
  dialogVisible.value = true
}

function openEdit(u: SafeUser) {
  editing.value = u
  form.username = u.username
  form.password = ''
  form.role = u.role
  dialogVisible.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      const patch: { role?: string; password?: string } = { role: form.role }
      if (form.password) patch.password = form.password
      await userApi.update(editing.value.id, patch)
      ElMessage.success('用户已更新')
    } else {
      await userApi.create({ username: form.username.trim(), password: form.password, role: form.role })
      ElMessage.success('用户已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleDisabled(u: SafeUser) {
  const target = u.disabled ? false : true
  const action = target ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(`确定要${action}用户「${u.username}」吗？`, '确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await userApi.update(u.id, { disabled: target })
    ElMessage.success(`已${action}`)
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || `${action}失败`)
  }
}

async function removeUser(u: SafeUser) {
  try {
    await ElMessageBox.confirm(`确定要删除用户「${u.username}」吗？此操作不可恢复。`, '删除用户', {
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    await userApi.remove(u.id)
    ElMessage.success('用户已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

onMounted(async () => {
  await loadRoles()
  await load()
})
</script>

<template>
  <div v-loading="loading">
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span class="card-title">用户管理</span>
          <el-button type="primary" @click="openCreate">新增用户</el-button>
        </div>
      </template>
      <el-table :data="users" border>
        <el-table-column prop="username" label="用户名" />
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div>{{ roleName(row.role) }}</div>
            <div class="role-desc">{{ roleDesc(row.role) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.disabled ? 'danger' : 'success'" size="small">
              {{ row.disabled ? '已停用' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" />
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row as SafeUser)">编辑</el-button>
            <el-button size="small" :type="row.disabled ? 'success' : 'warning'" @click="toggleDisabled(row as SafeUser)">
              {{ row.disabled ? '启用' : '停用' }}
            </el-button>
            <el-button size="small" type="danger" @click="removeUser(row as SafeUser)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑用户' : '新增用户'" width="460px">
      <el-form label-width="80px">
        <el-form-item label="用户名">
          <el-input v-model="form.username" :disabled="!!editing" />
        </el-form-item>
        <el-form-item :label="editing ? '新密码' : '密码'">
          <el-input v-model="form.password" type="password" show-password
            :placeholder="editing ? '留空则不修改密码' : '请输入密码'" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id">
              <span>{{ r.name }}</span>
              <span style="float: right; color: var(--el-text-color-secondary); font-size: 12px">
                {{ r.builtin ? '内置' : '自定义' }}
              </span>
            </el-option>
          </el-select>
          <div class="role-desc">可在「角色权限」中自定义角色的权限点</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.card-title {
  font-weight: 600;
}
.role-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
</style>
