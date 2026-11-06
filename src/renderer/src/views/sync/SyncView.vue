<template>
  <div class="sync-view">
    <h2>同步与备份</h2>

    <el-card header="云盘同步">
      <el-form label-width="110px">
        <el-form-item label="同步方式">
          <el-radio-group v-model="type">
            <el-radio value="">关闭</el-radio>
            <el-radio value="local">本地目录</el-radio>
            <el-radio value="webdav">WebDAV</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="type === 'local'">
          <el-form-item label="同步目录">
            <el-input v-model="localDir" placeholder="选择用于同步的本地目录" readonly>
              <template #append>
                <el-button @click="pickLocalDir">选择目录</el-button>
              </template>
            </el-input>
          </el-form-item>
        </template>

        <template v-if="type === 'webdav'">
          <el-form-item label="服务器地址">
            <el-input v-model="webdavUrl" placeholder="https://dav.example.com/dav/" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="webdavUsername" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="webdavPassword" type="password" show-password />
          </el-form-item>
        </template>

        <el-form-item>
          <el-button type="primary" @click="save">保存配置</el-button>
          <el-button type="success" :loading="syncing" @click="sync">立即同步</el-button>
        </el-form-item>
        <el-form-item label="上次同步">
          <span>{{ lastTime || '从未同步' }}</span>
        </el-form-item>
      </el-form>

      <el-divider />
      <el-button :loading="downloading" @click="restoreFromCloud">从云盘恢复</el-button>
      <span class="hint">恢复将覆盖当前账套数据，并自动重启软件。</span>
    </el-card>

    <el-card header="手动备份" class="mt">
      <el-button type="primary" @click="backupNow">选择目录并备份</el-button>
      <el-button @click="loadList">刷新备份列表（自动备份目录）</el-button>

      <el-table :data="backups" size="small" class="mt">
        <el-table-column prop="name" label="文件名" min-width="260" />
        <el-table-column label="大小">
          <template #default="{ row }">{{ formatSize((row as BackupInfo).size) }}</template>
        </el-table-column>
        <el-table-column label="时间">
          <template #default="{ row }">{{ formatTime((row as BackupInfo).mtime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="restore((row as BackupInfo).name)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="hint">自动备份保存在软件数据目录的 backups 子目录；手动备份由您选择保存位置。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BackupInfo } from '../../../../main/services/backup/backup.service'
import { backupApi } from '../../api/backup'
import { syncApi } from '../../api/sync'

const type = ref<'' | 'local' | 'webdav'>('')
const localDir = ref('')
const webdavUrl = ref('')
const webdavUsername = ref('')
const webdavPassword = ref('')
const lastTime = ref('')
const backups = ref<BackupInfo[]>([])
const syncing = ref(false)
const downloading = ref(false)

async function loadConfig(): Promise<void> {
  const cfg = await syncApi.getConfig()
  type.value = cfg.type
  localDir.value = cfg.local.dir
  webdavUrl.value = cfg.webdav.url
  webdavUsername.value = cfg.webdav.username
  webdavPassword.value = cfg.webdav.password
  lastTime.value = cfg.last_time ? new Date(cfg.last_time).toLocaleString() : ''
}

async function save(): Promise<void> {
  if (type.value === 'local' && !localDir.value) {
    ElMessage.warning('请选择同步目录')
    return
  }
  if (type.value === 'webdav' && !webdavUrl.value) {
    ElMessage.warning('请填写服务器地址')
    return
  }
  await syncApi.saveConfig({
    type: type.value,
    local: { dir: localDir.value },
    webdav: { url: webdavUrl.value, username: webdavUsername.value, password: webdavPassword.value }
  })
  ElMessage.success('配置已保存')
}

async function pickLocalDir(): Promise<void> {
  try {
    const dir = await backupApi.pickDir()
    if (dir) localDir.value = dir
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function sync(): Promise<void> {
  syncing.value = true
  try {
    await save()
    await syncApi.now()
    ElMessage.success('同步完成')
    await loadConfig()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    syncing.value = false
  }
}

async function restoreFromCloud(): Promise<void> {
  downloading.value = true
  try {
    const tempPath = await syncApi.download()
    await ElMessageBox.confirm('将从云盘下载数据并覆盖当前账套，确定继续吗？', '恢复确认', { type: 'warning' })
    const r = await syncApi.restoreFromCloud(tempPath)
    if (r.needRestart) {
      await ElMessageBox.alert('恢复完成，即将重启软件。', '提示')
      window.location.reload()
    }
  } catch (e) {
    if ((e as Error).message !== 'cancel') ElMessage.error((e as Error).message)
  } finally {
    downloading.value = false
  }
}

async function backupNow(): Promise<void> {
  try {
    const p = await backupApi.now()
    ElMessage.success(`备份完成：${p}`)
  } catch (e) {
    if ((e as Error).message !== '已取消') ElMessage.error((e as Error).message)
  }
}

async function loadList(): Promise<void> {
  try {
    backups.value = await backupApi.list()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function restore(name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定用备份「${name}」覆盖当前数据吗？恢复后软件将重启。`, '恢复确认', { type: 'warning' })
    const r = await backupApi.restore(name)
    if (r.needRestart) {
      await ElMessageBox.alert('恢复完成，即将重启软件。', '提示')
      window.location.reload()
    }
  } catch (e) {
    if ((e as Error).message !== 'cancel') ElMessage.error((e as Error).message)
  }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

onMounted(() => {
  void loadConfig()
  void loadList()
})
</script>

<style scoped>
.sync-view {
  max-width: 860px;
}
.mt {
  margin-top: 16px;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 8px;
}
</style>
