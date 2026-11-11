<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import brandIcon from '../assets/hesora.svg'
import { licenseApi, type LicenseStatus } from '../api/license'

const status = ref<LicenseStatus | null>(null)
const resetting = ref(false)

const phaseText: Record<string, string> = {
  trial: '全功能试用',
  expired: '试用结束（只读）',
  activated: '已激活'
}

async function loadStatus(): Promise<void> {
  try {
    status.value = await licenseApi.check()
  } catch {
    status.value = null
  }
}

async function onResetDemo(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将清空当前全部业务数据（商品、单据、往来、资金等），并重灌初始演示数据。此操作不可撤销，请先备份。确定重置吗？',
      '重置演示数据',
      { confirmButtonText: '重置', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  resetting.value = true
  try {
    await licenseApi.resetDemo()
    ElMessage.success('演示数据已重置为初始演示态（试用计时不受影响）')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    resetting.value = false
  }
}

onMounted(loadStatus)
</script>

<template>
  <div class="about-page">
    <el-card shadow="never">
      <div class="about-brand"><img :src="brandIcon" alt="禾序图标" /><div><div class="brand-eyebrow">HESORA INVENTORY</div><h1>禾序进销存</h1><p>货有数，账有序。</p></div></div>
      <p class="about-description">为商户与中小企业打造的 Windows 本地进销存软件。让商品、采购、销售、库存和往来记录有序连接，让每一笔生意清楚有据。</p>
      <el-divider />
      <div class="about-values"><section><h3>日常业务，本地运行</h3><p>经营记录保存在本机，日常开单与查账无需持续联网。</p></section><section><h3>经营数据，由你掌握</h3><p>按需导出与备份，恢复前核对数据，妥善保管异盘副本。</p></section><section><h3>从单据，看清经营</h3><p>连接货物与款项记录，为库存、往来和经营决策提供依据。</p></section></div>

      <!-- 试用状态（7 天全功能试用，到期只读） -->
      <el-divider />
      <div v-if="status" class="trial-box">
        <div class="trial-info">
          <span class="trial-phase" :class="'phase-' + status.phase">{{ phaseText[status.phase] ?? status.phase }}</span>
          <span v-if="status.mode === 'trial' && status.daysLeft !== undefined" class="trial-days">
            剩余 {{ status.daysLeft }} 天
          </span>
          <span v-if="status.mode === 'licensed'" class="trial-days">授权用户：{{ status.customer ?? '—' }}</span>
        </div>
        <div class="trial-actions">
          <el-button type="warning" plain :loading="resetting" @click="onResetDemo">重置演示数据</el-button>
          <a href="https://hesora.xclock.online/buy/" target="_blank" rel="noopener noreferrer">购买授权 →</a>
        </div>
      </div>

      <el-alert type="info" :closable="false" title="数据保障提示" description="请定期备份并验证恢复。云盘目录复制成功不代表远端上传完成；多台电脑产生的业务记录不会自动合并。" show-icon />
    </el-card>
  </div>
</template>

<style scoped>
.about-page { padding: 24px; max-width: 1100px; margin: 0 auto; }
.about-page :deep(.el-card__body) { padding: 40px; }
.about-brand { display: flex; gap: 24px; align-items: center; }
.about-brand img { width: 88px; }
h1 { margin: 8px 0; font-size: 32px; }
.about-brand p { margin: 0; color: #12685e; }
.about-description { max-width: 740px; line-height: 1.9; margin: 30px 0; }
.about-values { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-bottom: 32px; }
h3 { font-size: 15px; }
.about-values p { color: #6a7c76; font-size: 13px; line-height: 1.8; }
.trial-box { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.trial-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.trial-phase { font-weight: 600; padding: 2px 10px; border-radius: 4px; background: #e8f3f1; color: #12685e; font-size: 13px; }
.phase-expired { background: #fdf0ee; color: #b4543e; }
.phase-activated { background: #eaf5ec; color: #2e7d43; }
.trial-days { color: #6a7c76; font-size: 13px; }
.trial-actions { display: flex; gap: 8px; }
</style>
