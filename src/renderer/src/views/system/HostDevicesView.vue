<template>
  <div class="host-devices">
    <el-card shadow="never">
      <template #header>
        <span>已配对设备</span>
        <el-button size="small" style="float: right" @click="refresh">刷新</el-button>
      </template>

      <el-table v-loading="loading" :data="devices" stripe>
        <el-table-column prop="device_name" label="设备名" min-width="160" />
        <el-table-column label="最后连接" min-width="160">
          <template #default="{ row }">
            {{ row.last_seen_at ? formatTime(row.last_seen_at) : '从未连接' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.revoked_at ? 'danger' : 'success'" size="small">
              {{ row.revoked_at ? '已吊销' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="配对时间" min-width="160">
          <template #default="{ row }">{{ formatTime(row.paired_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.revoked_at"
              type="danger"
              size="small"
              plain
              @click="revoke(row)"
            >吊销</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
// 渲染层只做展示与交互：数据经 host:listDevices / host:revokeDevice，不碰 FS/DB。
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { call } from '../../api/call'

interface PairedDevice {
  device_id: string
  device_name: string
  paired_at: number
  revoked_at: number | null
  last_seen_at: number | null
}

const devices = ref<PairedDevice[]>([])
const loading = ref(false)

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    devices.value = await call<PairedDevice[]>('host:listDevices')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取设备列表失败')
  } finally {
    loading.value = false
  }
}

// 危险操作（吊销后该设备将无法再连接）：二次确认。
async function revoke(row: PairedDevice): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `吊销后「${row.device_name}」将无法再连接本机，需要重新配对。确定吊销？`,
      '吊销设备',
      { confirmButtonText: '吊销', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }
  try {
    await call('host:revokeDevice', { deviceId: row.device_id })
    ElMessage.success(`已吊销设备「${row.device_name}」`)
    void refresh()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '吊销失败')
  }
}

onMounted(refresh)
</script>

<style scoped>
.host-devices { padding: 16px; }
</style>
