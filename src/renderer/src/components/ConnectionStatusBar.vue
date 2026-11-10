<template>
  <el-alert
    v-if="show"
    :title="title"
    :type="barSevere ? 'error' : 'warning'"
    :closable="false"
    show-icon
    class="conn-bar"
  />
</template>

<script setup lang="ts">
// 连接状态条：消费两套状态——
// ① 主机侧 lan-state（lan:state-changed 布尔，App.vue 已订阅）；
// ② v1.4 客户端侧 clientConnState（lan:client-state 结构化推送，client-state.ts 已订阅）。
// T8 双审 B7 裁定：仅本会话「曾连接过」后才报断开（避免主机模式下从未连接也常驻黄条）；
// severe（invoke 被安全策略拦截）在重连成功后复位，不再永久卡红。
// v1.4 T9：客户端 revoked 亦用红条（手册 §2.3 文案），connecting 用黄条提示写操作暂停。
import { computed, ref, watch } from 'vue'
import { lanState } from '../lib/lan-state'
import { clientConnState, clientModeActive } from '../lib/client-state'

const severe = ref(false)
const everConnected = ref(false)

// 客户端条：configured（有持久化配置）即显示，避免"曾连接"判断在重启后丢失提醒。
const clientShow = computed(() => clientModeActive.value && clientConnState.status !== 'connected')

const clientTitle = computed(() => {
  const st = clientConnState.status
  if (st === 'revoked') return '本机已被主机吊销，需重新配对后才能继续操作（系统与数据 → 客户端连接）'
  if (st === 'connecting') return clientConnState.lastError || '正在连接主机，写操作暂停；恢复后自动可用'
  if (st === 'error') return clientConnState.lastError || '与主机连接异常，写操作暂停'
  return '尚未连接主机，写操作暂停；请在「系统与数据 → 客户端连接」中连接'
})

const clientSevere = computed(() => clientConnState.status === 'revoked' || clientConnState.status === 'error')

// 主机模式（无客户端角色）沿用原逻辑。
const hostShow = computed(() => !clientModeActive.value && !lanState.connected && everConnected.value)

const hostTitle = computed(() =>
  severe.value
    ? 'LAN 协作连接异常：部分操作被本机安全策略拦截，请检查主机防火墙/网络设置'
    : 'LAN 协作已断开：主机不可达，数据仍在本地保存，恢复连接后自动恢复'
)

const show = computed(() => clientShow.value || hostShow.value)
const title = computed(() => (clientShow.value ? clientTitle.value : hostTitle.value))
const barSevere = computed(() => (clientShow.value ? clientSevere.value : severe.value))

watch(
  () => [lanState.connected, lanState.lastBlockedAt] as const,
  ([connected, lastBlockedAt]) => {
    if (connected) {
      // 重连成功：恢复正常态（severe 复位 + 记录曾连接）。
      everConnected.value = true
      severe.value = false
    } else if (lastBlockedAt !== null) {
      severe.value = true
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.conn-bar {
  border-radius: 0;
}
</style>
