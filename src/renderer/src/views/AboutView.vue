<script setup lang="ts">
import brandIcon from '../assets/hesora.svg'
</script>

<template>
  <div class="about-page">
    <el-card shadow="never">
      <div class="about-brand"><img :src="brandIcon" alt="禾序图标" /><div><div class="brand-eyebrow">HESORA INVENTORY</div><h1>禾序进销存</h1><p>货有数，账有序。</p></div></div>
      <p class="about-description">为商户与中小企业打造的 Windows 本地进销存软件。让商品、采购、销售、库存和往来记录有序连接，让每一笔生意清楚有据。</p>
      <el-divider />
      <div class="about-values"><section><h3>日常业务，本地运行</h3><p>经营记录保存在本机，日常开单与查账无需持续联网。</p></section><section><h3>经营数据，由你掌握</h3><p>按需导出与备份，恢复前核对数据，妥善保管异盘副本。</p></section><section><h3>从单据，看清经营</h3><p>连接货物与款项记录，为库存、往来和经营决策提供依据。</p></section></div>
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
</style>
