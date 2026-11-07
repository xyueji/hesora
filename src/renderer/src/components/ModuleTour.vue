<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { settingApi } from '../api/setting'
import { currentUser } from '../stores/auth'

const route = useRoute()
const tours: Record<string, [string, string]> = {
  'product-list': ['先录入商品', '添加商品与常用条码，开单时可按名称、编码或条码查找。'],
  opening: ['录入期初数据', '开始正式交易前，确认各仓库库存和往来单位期初余额。'],
  'purchase-list': ['管理采购', '采购入库增加库存，退货时选择原采购单可追溯来源。'],
  'sale-list': ['管理销售', '在这里开销售单、查询历史单据并办理退货。'],
  'retail-pos': ['快速收银', '选择商品、仓库和收款账户，确认后完成收款出库。'],
  'inventory-stock': ['查询库存', '可按商品和仓库定位库存，再查看当前数量。'],
  'stats-business': ['核对经营数据', '用日期区间筛选交易和资金流水，也可导出结果。'],
  sync: ['备份账套', '手动备份前可选择存放目录；使用云盘时请只在一台电脑写入。']
}

const visible = ref(false)
const step = ref<[string, string]>()
let activeKey = ''

watch(() => route.name, async (name, _old, onCleanup) => {
  visible.value = false
  const user = currentUser.value
  const key = typeof name === 'string' ? name : ''
  const item = tours[key]
  if (!item || user?.role !== 'admin') return
  const storageKey = `guide.module.${user.id}.${key}`
  if (localStorage.getItem(storageKey)) return
  let obsolete = false
  onCleanup(() => { obsolete = true })
  try {
    const enabled = await settingApi.get('guide.show')
    await nextTick()
    if (obsolete || enabled === '0') return
    step.value = item
    activeKey = storageKey
    visible.value = true
  } catch {
    // Keep the work area accessible if the preference cannot be read.
  }
}, { immediate: true, flush: 'post' })

function dismiss() {
  if (activeKey) localStorage.setItem(activeKey, '1')
  activeKey = ''
}
</script>

<template>
  <el-tour v-model="visible" :show-close="true" @close="dismiss" @finish="dismiss">
    <el-tour-step
      v-if="step"
      target=".layout-header"
      :title="step[0]"
      :description="step[1]"
      :next-button-props="{ children: '知道了' }"
    />
  </el-tour>
</template>
