<script setup lang="ts">
import PaymentEditView from './PaymentEditView.vue'

defineProps<{ mode: 'receipt' | 'payment' }>()
</script>

<template>
  <PaymentEditView :mode="mode" />
</template>
