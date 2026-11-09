<template>
  <el-alert
    v-if="show"
    :title="title"
    :type="severe ? 'error' : 'warning'"
    :closable="false"
    show-icon
    class="conn-bar"
  />
</template>

<script setup lang="ts">
// 连接状态条：消费 lan-state reactive（App.vue 已订阅 lan:state-changed 布尔写入）。
// T8 双审 B7 裁定：仅本会话「曾连接过」后才报断开（避免主机模式下从未连接也常驻黄条）；
// severe（invoke 被安全策略拦截）在重连成功后复位，不再永久卡红。
import { computed, ref, watch } from 'vue'
import { lanState } from '../lib/lan-state'

const severe = ref(false)
const everConnected = ref(false)

// 仅当曾连接过、当前断开时显示（本次会话内断开才提醒，符合「曾连接才报断开」）。
const show = computed(() => !lanState.connected && everConnected.value)

const title = computed(() =>
  severe.value
    ? 'LAN 协作连接异常：部分操作被本机安全策略拦截，请检查主机防火墙/网络设置'
    : 'LAN 协作已断开：主机不可达，数据仍在本地保存，恢复连接后自动恢复'
)

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
