<script setup lang="ts">
import { onMounted } from 'vue'
import MainLayout from './layouts/MainLayout.vue'
import { setLanConnected } from './lib/lan-state'

// v1.3 Task 8: 打通 preload lan:state-changed → lanState（主进程在 LAN 主机启停、
// 设备连上/断开时 send('lan:state-changed', { connected, clients? })）。
onMounted(() => {
  window.api.onLanStateChanged((connected: boolean) => setLanConnected(connected))
})
</script>

<template>
  <router-view v-if="$route.path === '/login' || $route.path === '/activate'" />
  <MainLayout v-else />
</template>
