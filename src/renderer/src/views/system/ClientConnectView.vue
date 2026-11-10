<template>
  <div class="client-connect">
    <el-card shadow="never">
      <template #header>
        <span>客户端连接 · 加入局域网协作</span>
        <el-tag v-if="st.status === 'connected'" type="success" size="small" style="margin-left: 8px">已连接</el-tag>
        <el-tag v-else-if="st.status === 'revoked'" type="danger" size="small" style="margin-left: 8px">已被吊销</el-tag>
        <el-tag v-else-if="st.status !== 'idle'" type="warning" size="small" style="margin-left: 8px">{{ statusText }}</el-tag>
      </template>

      <!-- 已连接：显示主机信息 + 断开 -->
      <template v-if="st.status === 'connected'">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="主机地址">{{ st.hostAddress }}</el-descriptions-item>
          <el-descriptions-item label="本机设备名">{{ st.deviceName }}</el-descriptions-item>
          <el-descriptions-item label="主机登录账号">{{ st.hostName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="最近连接">{{ st.lastConnectedAt ? formatTime(st.lastConnectedAt) : '—' }}</el-descriptions-item>
        </el-descriptions>
        <div style="margin-top: 16px">
          <el-button type="warning" @click="doDisconnect">断开连接</el-button>
          <el-button @click="doForget">忘记主机</el-button>
        </div>
        <p class="hint">所有单据数据实时保存在主机上；断开期间写操作（开单/收款等）将暂停。</p>
      </template>

      <!-- revoked：醒目提示 + 重新配对 -->
      <template v-else-if="st.status === 'revoked'">
        <el-alert type="error" :closable="false" show-icon
          title="本机已被主机吊销，需重新配对"
          description="主机管理员已移除本设备的配对授权。请重新填写主机账号密码申请配对，或在主机端重新允许本设备。" />
        <el-form style="margin-top: 16px" label-width="100px" @submit.prevent="doPairStart">
          <el-form-item label="主机地址" required>
            <el-input v-model="form.address" placeholder="如 192.168.1.10:18650" style="width: 320px" />
          </el-form-item>
          <el-form-item label="本机设备名" required>
            <el-input v-model="form.deviceName" placeholder="如：前台收银机" style="width: 320px" />
          </el-form-item>
          <el-form-item label="主机账号" required>
            <el-input v-model="form.username" style="width: 320px" />
          </el-form-item>
          <el-form-item label="主机密码" required>
            <el-input v-model="form.password" type="password" show-password style="width: 320px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="doPairStart">重新申请配对</el-button>
          </el-form-item>
        </el-form>
      </template>

      <!-- pairing：显示配对码等待主机确认 -->
      <template v-else-if="st.status === 'pairing'">
        <el-result icon="info" title="等待主机确认配对">
          <template #sub-title>
            <p>请在主机端「设备配对」中确认本设备（<b>{{ st.deviceName }}</b>）的配对请求。</p>
            <p class="pair-code" v-if="st.pairingCode">
              配对码：<b>{{ st.pairingCode }}</b>
              <span v-if="st.pairingExpiresAt">（{{ remainText }} 后过期）</span>
            </p>
            <p class="hint">确认通过后将自动建立会话并连接，无需其他操作。</p>
          </template>
        </el-result>
      </template>

      <!-- connecting -->
      <template v-else-if="st.status === 'connecting'">
        <el-result icon="loading" title="正在连接主机…">
          <template #sub-title>
            <p>{{ st.hostAddress || '' }}</p>
            <p v-if="st.lastError" class="hint">{{ st.lastError }}</p>
          </template>
        </el-result>
        <div style="text-align: center">
          <el-button @click="doDisconnect">取消</el-button>
        </div>
      </template>

      <!-- idle / error：连接表单 -->
      <template v-else>
        <el-alert v-if="st.status === 'error' && st.lastError" type="error" :closable="false" show-icon
          :title="st.lastError" style="margin-bottom: 16px" />
        <el-alert v-if="st.configured" type="info" :closable="false" show-icon
          :title="`已保存主机配置：${st.hostAddress || ''}（设备：${st.deviceName || ''}），可直接重连`"
          style="margin-bottom: 16px" />
        <el-form label-width="100px" @submit.prevent="st.configured ? doReconnect() : doPairStart()">
          <el-form-item label="主机地址" required>
            <el-input v-model="form.address" :placeholder="`如 192.168.1.10:18650（建议：${st.suggestedAddress || '192.168.1.10:18650'}）`" style="width: 360px" />
          </el-form-item>
          <el-form-item v-if="!st.configured" label="本机设备名" required>
            <el-input v-model="form.deviceName" placeholder="如：前台收银机" style="width: 360px" />
          </el-form-item>
          <el-form-item label="主机账号" required>
            <el-input v-model="form.username" autocomplete="off" style="width: 360px" />
          </el-form-item>
          <el-form-item label="主机密码" required>
            <el-input v-model="form.password" type="password" show-password autocomplete="new-password" style="width: 360px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="st.configured ? doReconnect() : doPairStart()">
              {{ st.configured ? '重连主机' : '申请配对' }}
            </el-button>
            <el-button v-if="st.configured" @click="doForget">忘记主机</el-button>
          </el-form-item>
        </el-form>
        <p class="hint">
          首次连接：填写主机地址、设备名与主机员工账号密码 → 主机端确认 → 自动建立会话。<br />
          客户端不能执行主机专属操作（备份/云同步等），此类操作请在主机上完成。
        </p>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
// 渲染层只做展示与交互：全部经 lan:client* IPC，不碰 FS/DB（AGENTS.md 红线 5）。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { call } from '../../api/call'
import { clientConnState as st } from '../../lib/client-state'

interface ClientStatusView {
  status: typeof st.status
  hostAddress: string | null
  deviceName: string | null
  configured: boolean
  suggestedAddress: string
  pairingCode: string | null
  pairingExpiresAt: number | null
}

const form = reactive({
  address: '',
  deviceName: '',
  username: '',
  password: ''
})
const submitting = ref(false)
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const remainText = computed(() => {
  if (!st.pairingExpiresAt) return ''
  const s = Math.max(0, Math.floor((st.pairingExpiresAt - nowTick.value) / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
})

const statusText = computed(() => {
  const map: Record<string, string> = {
    pairing: '等待主机确认',
    connecting: '连接中',
    error: '连接出错'
  }
  return map[st.status] ?? st.status
})

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function prefill(): void {
  if (!form.address) form.address = st.hostAddress || st.suggestedAddress || ''
  if (!form.deviceName) form.deviceName = st.deviceName || ''
}

async function refreshStatus(): Promise<void> {
  try {
    const s = await call<ClientStatusView>('lan:clientStatus')
    Object.assign(st, s)
    prefill()
  } catch {
    /* 首屏竞态容错：推送会纠正 */
  }
}

async function doPairStart(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await call('lan:clientPairStart', {
      address: form.address,
      deviceName: form.deviceName,
      username: form.username,
      password: form.password
    })
    ElMessage.success('配对申请已发送，等待主机确认')
  } catch (e) {
    ElMessage.error((e as Error).message || '配对申请失败')
  } finally {
    submitting.value = false
  }
}

async function doReconnect(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await call('lan:clientConnect', { username: form.username, password: form.password })
    ElMessage.success('已重新连接主机')
  } catch (e) {
    ElMessage.error((e as Error).message || '重连失败')
  } finally {
    submitting.value = false
  }
}

async function doDisconnect(): Promise<void> {
  try {
    await call('lan:clientDisconnect')
    ElMessage.success('已断开（保留配对信息，可随时重连）')
  } catch (e) {
    ElMessage.error((e as Error).message || '断开失败')
  }
}

async function doForget(): Promise<void> {
  try {
    await call('lan:clientForget')
    form.username = ''
    form.password = ''
    ElMessage.success('已忘记主机，可重新申请配对')
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败')
  }
}

onMounted(() => {
  void refreshStatus()
  prefill()
  tickTimer = setInterval(() => (nowTick.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<style scoped>
.client-connect {
  padding: 8px;
}
.pair-code {
  font-size: 15px;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.8;
}
</style>
