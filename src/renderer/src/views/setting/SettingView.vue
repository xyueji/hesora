<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { settingApi } from '../../api/setting'

const loading = ref(false)
const saving = ref(false)
const form = reactive({
  'shop.name': '',
  'shop.phone': '',
  'shop.address': '',
  'shop.receipt_header': '',
  'guide.show': true
})

onMounted(async () => {
  loading.value = true
  try {
    const all = await settingApi.getAll()
    for (const key of Object.keys(form)) {
      const v = all[key]
      if (key === 'guide.show') {
        form['guide.show'] = v !== '0'
      } else if (v !== undefined) {
        form[key] = v
      }
    }
  } catch (e) {
    ElMessage.error((e as Error).message || '加载设置失败')
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    await settingApi.set('shop.name', form['shop.name'])
    await settingApi.set('shop.phone', form['shop.phone'])
    await settingApi.set('shop.address', form['shop.address'])
    await settingApi.set('shop.receipt_header', form['shop.receipt_header'])
    await settingApi.set('guide.show', form['guide.show'] ? '1' : '0')
    ElMessage.success('设置已保存')
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="setting-view" v-loading="loading">
    <el-card>
      <template #header>
        <span class="card-title">系统设置</span>
      </template>
      <el-form label-width="120px" style="max-width: 560px">
        <el-divider content-position="left">店铺信息</el-divider>
        <el-form-item label="店铺名称">
          <el-input v-model="form['shop.name']" placeholder="请输入店铺名称" />
        </el-form-item>
        <el-form-item label="店铺电话">
          <el-input v-model="form['shop.phone']" placeholder="请输入店铺电话" />
        </el-form-item>
        <el-form-item label="店铺地址">
          <el-input v-model="form['shop.address']" placeholder="请输入店铺地址" />
        </el-form-item>
        <el-form-item label="单据小票抬头">
          <el-input v-model="form['shop.receipt_header']" placeholder="打印在小票顶部的抬头文字" />
        </el-form-item>
        <el-divider content-position="left">显示开关</el-divider>
        <el-form-item label="新手引导">
          <el-checkbox v-model="form['guide.show']">是否显示新手引导</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.setting-view {
  padding: 24px;
}
.card-title {
  font-weight: 600;
}
</style>
