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
        <el-sub-menu index="purchase-group">
          <template #title>采购</template>
          <el-menu-item index="/purchase/edit">开进货单</el-menu-item>
          <el-menu-item index="/purchase/list">进货单列表</el-menu-item>
          <el-menu-item index="/purchase/return-edit">开采购退货单</el-menu-item>
          <el-menu-item index="/purchase/return-list">采购退货单列表</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="sale-group">
          <template #title>销售</template>
          <el-menu-item index="/sale/edit">开销售单</el-menu-item>
          <el-menu-item index="/sale/list">销售单列表</el-menu-item>
          <el-menu-item index="/sale/return-edit">开销售退货单</el-menu-item>
          <el-menu-item index="/sale/return-list">销售退货单列表</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="retail-group">
          <template #title>零售</template>
          <el-menu-item index="/retail/pos">快速零售</el-menu-item>
          <el-menu-item index="/retail/list">零售单列表</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/product/list">商品管理</el-menu-item>
        <el-menu-item index="/customer/list">客户</el-menu-item>
        <el-menu-item index="/supplier/list">供应商</el-menu-item>
        <el-menu-item index="/warehouse/list">仓库</el-menu-item>
        <el-menu-item index="/account/list">资金账户</el-menu-item>
        <el-sub-menu index="payment-group">
          <template #title>资金</template>
          <el-menu-item index="/payment/receipt">收款单</el-menu-item>
          <el-menu-item index="/payment/payment">付款单</el-menu-item>
          <el-menu-item index="/payment/list">收付款列表</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="inventory-group">
          <template #title>库存</template>
          <el-menu-item index="/inventory/statistics">库存汇总</el-menu-item>
          <el-menu-item index="/transfer/edit">开调拨单</el-menu-item>
          <el-menu-item index="/transfer/list">调拨单列表</el-menu-item>
          <el-menu-item index="/stocktake/edit">开盘点单</el-menu-item>
          <el-menu-item index="/stocktake/list">盘点单列表</el-menu-item>
          <el-menu-item index="/assemble/edit">开组装拆卸单</el-menu-item>
          <el-menu-item index="/assemble/list">组装拆卸单列表</el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="stats-group">
          <template #title>报表</template>
          <el-menu-item index="/stats/arrears">应收应付</el-menu-item>
          <el-menu-item index="/doc/search">单据查询</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/opening">期初建账</el-menu-item>
        <el-menu-item index="/setting">设置</el-menu-item>
        <el-menu-item index="/sync">同步备份</el-menu-item>
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
