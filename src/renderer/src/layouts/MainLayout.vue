<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <el-container class="main-layout">
    <el-aside width="200px" class="layout-aside">
      <div class="brand">进销存管理系统</div>
      <el-menu router :default-active="route.path" class="layout-menu">
        <el-menu-item index="/">首页</el-menu-item>
        <el-menu-item index="/product/list">商品管理</el-menu-item>
        <el-menu-item index="/customer/list">客户</el-menu-item>
        <el-menu-item index="/supplier/list">供应商</el-menu-item>
        <el-menu-item index="/warehouse/list">仓库</el-menu-item>
        <el-menu-item index="/account/list">资金账户</el-menu-item>
        <el-menu-item index="/inventory/statistics">库存</el-menu-item>
        <el-menu-item index="/setting">设置</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="layout-header">
        <span>默认仓库</span>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.main-layout {
  height: 100vh;
}

.layout-aside {
  border-right: 1px solid var(--el-border-color);
}

.brand {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

.layout-menu {
  border-right: none;
}

.layout-header {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color);
}
</style>
