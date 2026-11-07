<script setup lang="ts">
import type { TrackingType } from '../../../shared/types/product'

defineProps<{
  tracking?: TrackingType
  receiveBatch?: boolean
  disabled?: boolean
  availableSerials?: string[]
}>()
const serialNumbers = defineModel<string[]>('serialNumbers', { default: () => [] })
const productionDate = defineModel<string>('productionDate')
const expireDate = defineModel<string>('expireDate')
</script>

<template>
  <el-select
    v-if="tracking === 'serial'"
    v-model="serialNumbers"
    multiple
    filterable
    :allow-create="availableSerials === undefined"
    :disabled="disabled"
    default-first-option
    placeholder="输入序列号后回车"
    style="width: 100%"
  >
    <el-option v-for="serial in availableSerials ?? serialNumbers" :key="serial" :label="serial" :value="serial" />
  </el-select>
  <div v-else-if="tracking === 'batch' && receiveBatch" class="dates">
    <el-date-picker v-model="productionDate" :disabled="disabled" type="date" value-format="YYYY-MM-DD" placeholder="生产日期" />
    <el-date-picker v-model="expireDate" :disabled="disabled" type="date" value-format="YYYY-MM-DD" placeholder="到期日期" />
  </div>
  <span v-else>—</span>
</template>

<style scoped>
.dates { display: grid; gap: 4px; }
.dates :deep(.el-date-editor) { width: 100%; }
</style>
