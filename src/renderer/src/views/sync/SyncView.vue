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
            <el-radio value="both">本地目录和 WebDAV</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="type === 'local' || type === 'both'">
          <el-form-item label="同步目录">
            <el-input v-model="localDir" placeholder="选择用于同步的本地目录" readonly>
              <template #append>
                <el-button @click="pickLocalDir">选择目录</el-button>
              </template>
            </el-input>
          </el-form-item>
        </template>

        <template v-if="type === 'webdav' || type === 'both'">
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
          <el-button type="primary" @click="saveConfig">保存配置</el-button>
          <el-button type="success" :loading="syncing" @click="sync">立即同步</el-button>
          <el-button v-if="type" :loading="checkingTargets" @click="checkTargets">检查各目标</el-button>
        </el-form-item>
        <el-form-item v-if="type" label="自动同步">
          <el-input-number v-model="intervalHours" :min="0" :max="168" />
          <span class="hint">每隔多少小时上传，0 为关闭</span>
        </el-form-item>
        <el-form-item label="上次同步">
          <span>{{ lastTime || '从未同步' }}</span>
        </el-form-item>
      </el-form>

      <p class="hint">请只在一台电脑写入账套，其他电脑从云盘恢复。同步以完整快照为单位。</p>
      <el-alert v-if="remoteSequence" type="warning" :closable="false" title="云盘上有更新的快照，请先恢复再上传。" />
      <el-table v-if="targetStatus.length" :data="targetStatus" class="mt">
        <el-table-column label="目标" width="120"><template #default="{ row }">{{ row.target === 'local' ? '目录副本' : 'WebDAV' }}</template></el-table-column>
        <el-table-column prop="sequence" label="快照版本" width="110" />
        <el-table-column label="快照时间" min-width="160"><template #default="{ row }">{{ row.timestamp ? new Date(row.timestamp).toLocaleString() : '—' }}</template></el-table-column>
        <el-table-column prop="detail" label="检查结果" min-width="220" />
        <el-table-column label="操作" width="100"><template #default="{ row }">
          <el-button v-if="row.state === 'available' || row.state === 'conflict'" link type="primary" :disabled="downloading" @click="previewCloud(row.target)">预览此副本</el-button>
        </template></el-table-column>
      </el-table>
      <el-alert v-if="lastError" type="error" :closable="false" :title="lastError" />
      <el-divider />
      <el-button :loading="downloading" @click="previewCloud()">预览云盘快照</el-button>
      <span class="hint">先核对本地与云盘记录。恢复前自动保留当前账套副本。</span>
    </el-card>

    <el-card header="手动备份" class="mt">
      <el-button type="primary" @click="backupNow">选择目录并备份</el-button>
      <el-button @click="restore('')">从备份文件恢复</el-button>
      <el-button @click="loadList">刷新备份列表（自动备份目录）</el-button>

      <el-table :data="filteredBackups" size="small" class="mt">
        <el-table-column prop="name" label="文件名" min-width="240" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ backupKind((row as BackupInfo).name) }}</template>
        </el-table-column>
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
      <div class="mt" style="margin-bottom: 8px">
        <el-radio-group v-model="kindFilter" size="small">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="sync">同步快照历史</el-radio-button>
          <el-radio-button value="daily">每日自动备份</el-radio-button>
          <el-radio-button value="other">其他</el-radio-button>
        </el-radio-group>
      </div>
      <p class="hint">自动备份保存在软件数据目录的 backups 子目录；每次同步前与每日首次启动都会自动留档（各保留 30 份），可作为快照历史恢复。手动备份由您选择保存位置。</p>
    </el-card>
  </div>
  <el-dialog v-model="previewVisible" title="核对云盘快照" width="min(680px, 92vw)" :close-on-click-modal="false" @closed="discardCloudPreview">
    <template v-if="preview">
      <p class="hint">{{ preview.source === 'local' ? '目录副本 · ' : preview.source === 'webdav' ? 'WebDAV · ' : '' }}{{ preview.sequence ? `快照版本 ${preview.sequence}` : '旧格式快照' }} · {{ preview.timestamp ? new Date(preview.timestamp).toLocaleString() : '生成时间未知' }}</p>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="本地商品">{{ preview.local.products }}</el-descriptions-item>
        <el-descriptions-item label="云盘商品">{{ preview.remote.products }}</el-descriptions-item>
        <el-descriptions-item label="本地往来单位">{{ preview.local.contacts }}</el-descriptions-item>
        <el-descriptions-item label="云盘往来单位">{{ preview.remote.contacts }}</el-descriptions-item>
        <el-descriptions-item label="本地过账单据">{{ preview.local.documents }}</el-descriptions-item>
        <el-descriptions-item label="云盘过账单据">{{ preview.remote.documents }}</el-descriptions-item>
        <el-descriptions-item label="本地最近业务日期">{{ preview.local.lastDocumentDate || '—' }}</el-descriptions-item>
        <el-descriptions-item label="云盘最近业务日期">{{ preview.remote.lastDocumentDate || '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="preview.localChanged" class="mt" type="warning" :closable="false" show-icon title="本地存在尚未同步或未建立同步基准的数据" />
      <el-checkbox v-if="preview.localChanged" v-model="acceptLocalChanges">我确认保留安全副本后，用此快照替换当前账套</el-checkbox>
    </template>
    <template #footer>
      <el-button :disabled="restoringCloud" @click="previewVisible = false">取消</el-button>
      <el-button type="danger" :loading="restoringCloud" :disabled="!preview || (preview.localChanged && !acceptLocalChanges)" @click="confirmCloudRestore">恢复并重启</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BackupInfo } from '../../../../main/services/backup/backup.service'
import { backupApi } from '../../api/backup'
import { syncApi } from '../../api/sync'
import type { SyncRestorePreview, SyncTargetStatus } from '../../../../main/services/sync/sync.service'

const type = ref<'' | 'local' | 'webdav' | 'both'>('')
const intervalHours = ref(0)
const remoteSequence = ref(0)
const lastError = ref('')
const localDir = ref('')
const webdavUrl = ref('')
const webdavUsername = ref('')
const webdavPassword = ref('')
const lastTime = ref('')
const backups = ref<BackupInfo[]>([])
const kindFilter = ref<'' | 'sync' | 'daily' | 'other'>('')

// 备份文件命名：hesora-inventory-<suffix>-<时间戳>-<uuid>.db
// suffix 为 before-sync（同步前留档）/ daily（每日备份）/ before-restore（恢复前安全副本）/ backup（手动）
function backupKind(name: string): string {
  if (name.includes('-before-sync-')) return '同步快照历史'
  if (name.includes('-daily-')) return '每日自动备份'
  if (name.includes('-before-restore-')) return '恢复前副本'
  return '手动备份'
}

const filteredBackups = computed(() => {
  if (!kindFilter.value) return backups.value
  return backups.value.filter((b) => {
    if (kindFilter.value === 'sync') return b.name.includes('-before-sync-')
    if (kindFilter.value === 'daily') return b.name.includes('-daily-')
    return !b.name.includes('-before-sync-') && !b.name.includes('-daily-')
  })
})
const syncing = ref(false)
const downloading = ref(false)
const restoringCloud = ref(false)
const previewVisible = ref(false)
const acceptLocalChanges = ref(false)
const preview = ref<SyncRestorePreview>()
const targetStatus = ref<SyncTargetStatus[]>([])
const checkingTargets = ref(false)

async function loadConfig(): Promise<void> {
  const cfg = await syncApi.getConfig()
  type.value = cfg.type
  intervalHours.value = cfg.intervalHours ?? 0
  remoteSequence.value = cfg.remoteSequence ?? 0
  lastError.value = cfg.lastError ?? ''
  localDir.value = cfg.local.dir
  webdavUrl.value = cfg.webdav.url
  webdavUsername.value = cfg.webdav.username
  webdavPassword.value = cfg.webdav.password
  lastTime.value = cfg.last_time ? new Date(cfg.last_time).toLocaleString() : ''
}

async function save(): Promise<boolean> {
  if ((type.value === 'local' || type.value === 'both') && !localDir.value) {
    ElMessage.warning('请选择同步目录')
    return false
  }
  if ((type.value === 'webdav' || type.value === 'both') && !webdavUrl.value) {
    ElMessage.warning('请填写服务器地址')
    return false
  }
  await syncApi.saveConfig({
    type: type.value,
    intervalHours: intervalHours.value,
    local: { dir: localDir.value },
    webdav: { url: webdavUrl.value, username: webdavUsername.value, password: webdavPassword.value }
  })
  return true
}

async function saveConfig() {
  try {
    if (await save()) ElMessage.success('配置已保存')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
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
    if (!(await save())) return
    await syncApi.now()
    ElMessage.success('同步完成')
    await loadConfig()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    syncing.value = false
  }
}

async function checkTargets(): Promise<void> {
  checkingTargets.value = true
  try {
    if (await save()) targetStatus.value = await syncApi.checkTargets()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    checkingTargets.value = false
  }
}

async function previewCloud(source?: 'local' | 'webdav'): Promise<void> {
  downloading.value = true
  try {
    preview.value = await syncApi.download(source)
    acceptLocalChanges.value = false
    previewVisible.value = true
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    downloading.value = false
  }
}

async function discardCloudPreview(): Promise<void> {
  const token = preview.value?.token
  preview.value = undefined
  if (token) await syncApi.cancelRestore(token).catch(() => undefined)
}

async function confirmCloudRestore(): Promise<void> {
  if (!preview.value || restoringCloud.value) return
  restoringCloud.value = true
  try {
    await syncApi.restoreFromCloud(preview.value.token, acceptLocalChanges.value)
  } catch (e) {
    ElMessage.error((e as Error).message)
    previewVisible.value = false
  } finally {
    restoringCloud.value = false
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
    if (name) await ElMessageBox.confirm(`确定用备份「${name}」覆盖当前数据吗？恢复后软件将重启。`, '恢复确认', { type: 'warning' })
    const r = await backupApi.restore(name)
    if (r.needRestart) {
      await ElMessageBox.alert('恢复完成，即将重启软件。', '提示')
      window.location.reload()
    }
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error((e as Error).message)
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
  void loadConfig().catch((e: Error) => ElMessage.error(e.message))
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
