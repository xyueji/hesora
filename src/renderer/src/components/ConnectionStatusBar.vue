<template>
  <el-alert
    v-if="!lanConnected"
    :title="title"
    :type="severe ? 'error' : 'warning'"
    :closable="false"
    show-icon
    class="conn-bar"
  />
</template>

<script setup lang="ts">
// 连接状态条：消费 lan-state reactive（App.vue 已订阅 lan:state-changed 布尔写入）。
// CONNECTED 时隐藏；断开显示黄条；曾发生 invoke 被安全策略拦截（lastBlockedAt 非空）时红条。
import { computed, ref, watch } from 'vue'
import { lanState } from '../lib/lan-state'

const severe = ref(false)

const lanConnected = computed(() => lanState.connected)

const title = computed(() =>
  severe.value
    ? 'LAN 协作连接异常：部分操作被本机安全策略拦截，请检查主机防火墙/网络设置'
    : 'LAN 协作已断开：主机不可达，数据仍在本地保存，恢复连接后自动恢复'
)

watch(
  () => [lanState.connected, lanState.lastBlockedAt] as const,
  () => {
    severe.value = lanState.lastBlockedAt !== null
  },
  { immediate: true }
)
</script>

<style scoped>
.conn-bar {
  border-radius: 0;
}
</style>
