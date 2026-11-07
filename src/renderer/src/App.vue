<script setup lang="ts">
import MainLayout from './layouts/MainLayout.vue'
</script>

<template>
  <router-view v-if="$route.path === '/login' || $route.path === '/activate'" />
  <MainLayout v-else />
</template>
