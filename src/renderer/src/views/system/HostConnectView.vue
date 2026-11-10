<template>
  <div class="host-connect">
    <el-card shadow="never">
      <template #header>
        <span>LAN 协作主机 · 配对</span>
        <el-tag v-if="statusEnabled" type="success" size="small" style="margin-left: 8px">运行中 :{{ statusPort }}</el-tag>
        <el-tag v-else type="info" size="small" style="margin-left: 8px">主机未启动</el-tag>
      </template>

      <el-row :gutter="24">
        <!-- 左：二维码 + 手动输码 -->
        <el-col :span="10">
          <div class="qr-area">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="配对二维码" class="qr-img" />
            <el-empty v-else-if="pairExpired" description="配对码已过期，请重新生成" :image-size="80" />
            <el-empty v-else description="主机未运行，无法生成二维码" :image-size="80" />
            <div v-if="pairExpired" style="margin-top: 4px">
              <el-button type="primary" size="small" :disabled="!statusEnabled" @click="regeneratePair">
                重新生成配对码
              </el-button>
            </div>
            <p v-if="pairInfo" class="pair-code">
              配对码：<b>{{ pairInfo.code }}</b>
              <span class="pair-expire">（{{ remainText }} 后过期）</span>
            </p>
          </div>

          <el-divider>客户端无法扫码？手动输码</el-divider>
          <el-form inline @submit.prevent="startManual">
            <el-form-item label="设备名">
              <el-input v-model="manualDeviceName" placeholder="如：前台收银机" style="width: 160px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :disabled="!statusEnabled || manualSubmitting" :loading="manualSubmitting" @click="startManual">
                生成配对码
              </el-button>
            </el-form-item>
          </el-form>
          <p class="hint">客户端在「加入协作」中输入上方 6 位配对码即可发起配对，确认请求会出现在下方。</p>
        </el-col>

        <!-- 右：待确认列表 -->
        <el-col :span="14">
          <h4>待确认设备</h4>
          <el-empty v-if="pending.length === 0" description="暂无待确认的配对请求（每 2 秒自动刷新）" :image-size="70" />
          <el-card v-for="p in pending" :key="p.code" shadow="never" class="pending-card">
            <div class="pending-row">
              <div>
                <div class="pending-name">{{ p.deviceName }}</div>
                <div class="pending-meta">配对码 {{ p.code }} · {{ remainOf(p.expiresAt) }} 后过期</div>
              </div>
              <div>
                <el-button type="primary" @click="grant(p.code)">允许</el-button>
                <el-button @click="deny(p.code)">拒绝</el-button>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
// 渲染层只做展示与交互：所有数据经 host:* IPC，不碰 FS/DB。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import { call } from '../../api/call'
import { handleSessionExpired } from '../../api/session-expired'

interface PairStartResult { code: string; expiresAt: number; ip: string | null; qrPayload: string }
interface PendingPairing { code: string; deviceName: string; expiresAt: number }
interface HostStatus { enabled: boolean; port: number; deviceCount: number; uptimeMs: number }

const statusEnabled = ref(false)
const statusPort = ref(0)
const qrDataUrl = ref('')
const pairInfo = ref<PairStartResult | null>(null)
const pending = ref<PendingPairing[]>([])
const manualDeviceName = ref('')
const manualSubmitting = ref(false)
const nowTick = ref(Date.now())

let pollTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

const remainText = computed(() => (pairInfo.value ? remainOf(pairInfo.value.expiresAt) : ''))

// 配对码过期即时反馈：倒计时归零立即清除二维码/配对码并给出过期提示，
// 不必等下一次 2s 轮询（或手动刷新）才感知。
const pairExpired = ref(false)
watch(
  () => [pairInfo.value?.expiresAt, nowTick.value] as const,
  ([expiresAt]) => {
    if (pairInfo.value && typeof expiresAt === 'number' && nowTick.value >= expiresAt) {
      pairExpired.value = true
      pairInfo.value = null
      qrDataUrl.value = ''
    }
  }
)

function clearPairExpired(): void {
  pairExpired.value = false
}

function remainOf(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - nowTick.value) / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
}

async function refreshStatus(): Promise<void> {
  try {
    const st = await call<HostStatus>('host:status')
    statusEnabled.value = st.enabled
    statusPort.value = st.port
    refreshStatusFails = 0
    if (!st.enabled) {
      pairInfo.value = null
      qrDataUrl.value = ''
      pending.value = []
      pairExpired.value = false
    }
  } catch (e) {
    // T8 双审 B8：轮询失败每 2s 弹错会刷屏——仅首次提示，连续失败静默。
    refreshStatusFails++
    if (refreshStatusFails === 1 && !handleSessionExpired(e)) {
      ElMessage.error(e instanceof Error ? e.message : '查询主机状态失败')
    }
  }
}
let refreshStatusFails = 0

async function startPairing(deviceName: string): Promise<void> {
  manualSubmitting.value = true
  clearPairExpired()
  try {
    const r = await call<PairStartResult>('host:pairStart', { deviceName })
    pairInfo.value = r
    qrDataUrl.value = await QRCode.toDataURL(r.qrPayload, { width: 200, margin: 1 })
  } catch (e) {
    if (!handleSessionExpired(e)) ElMessage.error(e instanceof Error ? e.message : '生成配对码失败')
  } finally {
    manualSubmitting.value = false
  }
}

function startManual(): void {
  clearPairExpired()
  const name = manualDeviceName.value.trim()
  if (!name) {
    ElMessage.warning('请先填写设备名')
    return
  }
  void startPairing(name)
}

/** 过期后一键重新生成：沿用上次填写的设备名（为空则回落到默认名）。 */
function regeneratePair(): void {
  const name = manualDeviceName.value.trim() || '本机设备'
  manualDeviceName.value = name
  void startPairing(name)
}

async function refreshPending(): Promise<void> {
  if (!statusEnabled.value) return
  try {
    pending.value = await call<PendingPairing[]>('host:pairPending')
  } catch {
    // 主机未启动等场景静默：状态栏已有提示，不重复弹错。
  }
}

async function grant(code: string): Promise<void> {
  try {
    const r = await call<{ deviceId: string }>('host:pairGrant', { code })
    ElMessage.success(`已允许设备接入（${r.deviceId.slice(0, 8)}…）`)
    pending.value = pending.value.filter((p) => p.code !== code)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '确认配对失败')
    void refreshPending()
  }
}

async function deny(code: string): Promise<void> {
  try {
    await call('host:pairDeny', { code })
    ElMessage.success('已拒绝该配对请求')
    pending.value = pending.value.filter((p) => p.code !== code)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '拒绝配对失败')
    void refreshPending()
  }
}

onMounted(() => {
  void refreshStatus().then(refreshPending)
  pollTimer = setInterval(() => {
    void refreshStatus()
    void refreshPending()
  }, 2000)
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<style scoped>
.host-connect { padding: 16px; }
.qr-area { text-align: center; margin-bottom: 12px; }
.qr-img { width: 200px; height: 200px; }
.pair-code { font-size: 15px; }
.pair-expire { color: var(--el-text-color-secondary); font-size: 12px; margin-left: 6px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; }
.pending-card { margin-bottom: 8px; }
.pending-row { display: flex; justify-content: space-between; align-items: center; }
.pending-name { font-weight: 600; }
.pending-meta { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }
</style>
