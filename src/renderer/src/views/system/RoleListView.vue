<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { roleApi } from '../../api/user'
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type AccessRole,
  type PermissionKey
} from '../../../../shared/permissions'

const loading = ref(false)
const saving = ref(false)
const roles = ref<AccessRole[]>([])
const dialogVisible = ref(false)
const editing = ref<AccessRole | null>(null)
const form = reactive<{ name: string; permissions: PermissionKey[] }>({ name: '', permissions: [] })

/** 管理员专属权限点不允许授予自定义角色 */
const adminOnly = ADMIN_ONLY_PERMISSIONS

const builtinRoles = computed(() => roles.value.filter((r) => r.builtin))
const customRoles = computed(() => roles.value.filter((r) => !r.builtin))

function groupSelected(group: { permissions: PermissionKey[] }): number {
  return group.permissions.filter((p) => form.permissions.includes(p)).length
}

function groupIndeterminate(group: { permissions: PermissionKey[] }): boolean {
  const n = groupSelected(group)
  return n > 0 && n < group.permissions.length
}

function toggleGroup(group: { permissions: PermissionKey[] }, checked: boolean) {
  const set = new Set(form.permissions)
  for (const p of group.permissions) {
    if (adminOnly.includes(p)) continue
    if (checked) set.add(p)
    else set.delete(p)
  }
  form.permissions = [...set]
}

function togglePermission(perm: PermissionKey, checked: boolean) {
  const set = new Set(form.permissions)
  if (checked) set.add(perm)
  else set.delete(perm)
  form.permissions = [...set]
}

async function load() {
  loading.value = true
  try {
    roles.value = await roleApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message || '加载角色失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.permissions = []
  dialogVisible.value = true
}

function openEdit(role: AccessRole) {
  editing.value = role
  form.name = role.name
  form.permissions = [...role.permissions]
  dialogVisible.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await roleApi.update(editing.value.id, { name: form.name.trim(), permissions: form.permissions })
      ElMessage.success('角色已更新')
    } else {
      await roleApi.create({ name: form.name.trim(), permissions: form.permissions })
      ElMessage.success('角色已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeRole(role: AccessRole) {
  try {
    await ElMessageBox.confirm(
      `确定要删除角色「${role.name}」吗？已分配给操作员的角色需先改派。`,
      '删除角色',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await roleApi.remove(role.id)
    ElMessage.success('角色已删除')
    await load()
  } catch (e) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span class="card-title">角色权限管理</span>
          <el-button type="primary" @click="openCreate">新增角色</el-button>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        角色决定操作员能看到的菜单与能执行的操作。内置角色不可修改；自定义角色可自由勾选权限点。
        「用户管理」「角色权限管理」为管理员专属，不可授予自定义角色。
      </el-alert>

      <el-table :data="builtinRoles" border style="margin-bottom: 16px">
        <el-table-column prop="name" label="内置角色" width="160" />
        <el-table-column label="权限点" min-width="260">
          <template #default="{ row }">
            <el-tag v-for="p in row.permissions" :key="p" size="small" style="margin: 2px 4px 2px 0">
              {{ (PERMISSIONS as Record<string, string>)[p] ?? p }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权限数" width="90" prop="permissions.length" />
        <el-table-column label="操作" width="120">
          <template #default>
            <el-button size="small" disabled>不可修改</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="section-title">自定义角色</div>
      <el-table :data="customRoles" border empty-text="暂无自定义角色">
        <el-table-column prop="name" label="角色名称" width="180" />
        <el-table-column label="权限点" min-width="300">
          <template #default="{ row }">
            <el-tag v-for="p in row.permissions" :key="p" size="small" style="margin: 2px 4px 2px 0">
              {{ (PERMISSIONS as Record<string, string>)[p] ?? p }}
            </el-tag>
            <span v-if="row.permissions.length === 0" class="muted">未分配权限</span>
          </template>
        </el-table-column>
        <el-table-column label="权限数" width="90">
          <template #default="{ row }">{{ row.permissions.length }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row as AccessRole)">配置权限</el-button>
            <el-button size="small" type="danger" @click="removeRole(row as AccessRole)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '配置角色权限' : '新增角色'" width="760px" top="6vh">
      <el-form label-width="80px">
        <el-form-item label="角色名称">
          <el-input v-model="form.name" maxlength="40" placeholder="例如：仓库管理员" style="max-width: 280px" />
        </el-form-item>
      </el-form>

      <div v-for="group in PERMISSION_GROUPS" :key="group.name" class="perm-group">
        <div class="perm-group-header">
          <el-checkbox
            :model-value="groupSelected(group) === group.permissions.length && group.permissions.length > 0"
            :indeterminate="groupIndeterminate(group)"
            @change="(v: boolean) => toggleGroup(group, v)"
          >
            <span class="perm-group-name">{{ group.name }}</span>
          </el-checkbox>
          <span class="muted">{{ groupSelected(group) }}/{{ group.permissions.length }}</span>
        </div>
        <div class="perm-list">
          <el-checkbox
            v-for="p in group.permissions"
            :key="p"
            :model-value="form.permissions.includes(p)"
            :disabled="adminOnly.includes(p)"
            @change="(v: boolean) => togglePermission(p, v)"
          >
            {{ PERMISSIONS[p] }}
            <span v-if="adminOnly.includes(p)" class="muted">（管理员专属）</span>
          </el-checkbox>
        </div>
      </div>

      <template #footer>
        <span class="muted" style="float: left; line-height: 32px">已选 {{ form.permissions.length }} 项权限</span>
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
.section-title {
  font-weight: 600;
  margin: 4px 0 10px;
}
.perm-group {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 10px;
}
.perm-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px dashed var(--el-border-color-lighter);
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.perm-group-name {
  font-weight: 600;
}
.perm-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 12px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
