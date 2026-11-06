<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { settingApi } from '../../api/setting'
import { licenseApi } from '../../api/license'

const route = useRoute()
const router = useRouter()

// replay=1：从"重新查看引导"菜单进入，不写 guide.show（保持 done 状态不变）
const replay = computed(() => route.query.replay === '1')

interface GuideStep {
  icon: string
  title: string
  desc: string
}

const steps: GuideStep[] = [
  { icon: '📦', title: '商品与往来单位', desc: '先录入商品、客户、供应商档案，后续单据直接引用。' },
  { icon: '🧾', title: '期初建账', desc: '录入各仓库的期初库存与应收应付，账目从此开始。' },
  { icon: '🚚', title: '采购入库', desc: '开进货单自动入库并记应付款，退货开采购退货单。' },
  { icon: '💼', title: '销售出库', desc: '开销售单自动出库并记应收款，退货开销售退货单。' },
  { icon: '🛒', title: '快速零售', desc: '前台收银走"快速零售"，即时收款即时出库。' },
  { icon: '📊', title: '报表与资金', desc: '库存汇总、应收应付、单据查询随时掌握经营情况。' },
  { icon: '☁️', title: '同步备份', desc: '在"同步备份"页配置网盘，数据归你，可随时备份恢复。' }
]

const active = ref(0)
const guideDone = ref(true)

onMounted(async () => {
  try {
    const show = await settingApi.get('guide.show')
    guideDone.value = show === '0'
    if (!replay.value) {
      // 试用剩余天数提示（登录页已提示，激活页兜底）
      try {
        const s = await licenseApi.check()
        if (s.mode === 'trial' && s.daysLeft !== undefined && s.daysLeft <= 3 && s.daysLeft > 0) {
          ElMessage.warning(`试用仅剩 ${s.daysLeft} 天，请在设置前完成激活`)
        }
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 引导页容错：读不到设置也允许浏览 */
  }
})

async function finish() {
  try {
    if (!replay.value || !guideDone.value) {
      await settingApi.set('guide.show', '0')
    }
    ElMessage.success('引导完成，开始使用吧！')
  } catch (e) {
    ElMessage.error((e as Error).message || '保存设置失败')
  }
  void router.push('/')
}

function skip() {
  if (!replay.value) {
    // 跳过 = 本次不再弹出（下次可从菜单"重新查看引导"进入）
    settingApi.set('guide.show', '0').catch(() => undefined)
  }
  void router.push('/')
}
</script>

<template>
  <div class="guide-page">
    <div class="guide-card">
      <h1 class="guide-title">欢迎使用进销存管理系统</h1>
      <p class="guide-sub">第一次使用？跟着这几步了解核心流程（约 1 分钟）</p>

      <el-steps :active="active" align-center finish-status="success" class="guide-steps">
        <el-step v-for="(s, i) in steps" :key="i" :title="s.title" />
      </el-steps>

      <div class="guide-body">
        <div class="guide-icon">{{ steps[active]?.icon }}</div>
        <h2>{{ steps[active]?.title }}</h2>
        <p>{{ steps[active]?.desc }}</p>
      </div>

      <div class="guide-actions">
        <el-button v-if="active > 0" @click="active--">上一步</el-button>
        <el-button v-if="active < steps.length - 1" type="primary" @click="active++">下一步</el-button>
        <el-button v-else type="primary" data-test="guide-finish" @click="finish">完成</el-button>
        <el-button text data-test="guide-skip" @click="skip">跳过引导</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  padding: 24px;
}

.guide-card {
  width: 720px;
  max-width: 100%;
  background: var(--el-bg-color);
  border-radius: 12px;
  padding: 40px 48px;
  box-shadow: var(--el-box-shadow-light);
}

.guide-title {
  text-align: center;
  margin: 0 0 8px;
  font-size: 22px;
}

.guide-sub {
  text-align: center;
  color: var(--el-text-color-secondary);
  margin: 0 0 32px;
}

.guide-steps {
  margin-bottom: 24px;
}

.guide-body {
  text-align: center;
  min-height: 160px;
}

.guide-icon {
  font-size: 56px;
  margin-bottom: 12px;
}

.guide-body h2 {
  margin: 0 0 8px;
}

.guide-body p {
  color: var(--el-text-color-secondary);
}

.guide-actions {
  margin-top: 24px;
  text-align: center;
}
</style>
