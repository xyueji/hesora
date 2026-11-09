<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import MainLayout from './layouts/MainLayout.vue'
import ConnectionStatusBar from './components/ConnectionStatusBar.vue'
import { setLanConnected } from './lib/lan-state'

// v1.3 Task 8: 打通 preload lan:state-changed → lanState（主进程在 LAN 主机启停、
// 设备连上/断开时 send('lan:state-changed', connected: boolean)——T8 双审勘误 C1：
// payload 为布尔，与 preload 契约一致）。onUnmounted 解绑防重复订阅泄漏。
let handler: ((connected: boolean) => void) | null = null
onMounted(() => {
  handler = (connected: boolean) => setLanConnected(connected)
  window.api.onLanStateChanged(handler)
})
onUnmounted(() => {
  handler = null
})
</script>

<template>
  <!-- v1.3 Task 8: 连接状态条置顶（CONNECTED 隐藏；断开黄/红条）。 -->
  <ConnectionStatusBar />
  <router-view v-if="$route.path === '/login' || $route.path === '/activate'" />
  <MainLayout v-else />
</template>
