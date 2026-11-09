<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { calendarSalesApi, type CalendarSalesDay } from '../../api/stats'

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1) // 1-12

const loading = ref(false)
const days = ref<Map<string, CalendarSalesDay>>(new Map())
const selectedDay = ref<string | null>(null)

const monthTotal = computed(() =>
  [...days.value.values()].reduce((s, d) => s + d.amount, 0)
)

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

/** 当月日历格子：前置空位（周一起始）+ 每日 */
interface Cell {
  day: number | null
  key: string
  info: CalendarSalesDay | null
  weekday: number
}

const cells = computed<Cell[]>(() => {
  const first = new Date(year.value, month.value - 1, 1)
  const daysInMonth = new Date(year.value, month.value, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // 周一 = 0
  const out: Cell[] = []
  for (let i = 0; i < lead; i++) {
    out.push({ day: null, key: `lead-${i}`, info: null, weekday: i })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dayKey(year.value, month.value, d)
    out.push({ day: d, key, info: days.value.get(key) ?? null, weekday: (lead + d - 1) % 7 })
  }
  return out
})

async function load(): Promise<void> {
  loading.value = true
  selectedDay.value = null
  try {
    const rows = await calendarSalesApi.query({ year: year.value, month: month.value })
    days.value = new Map(rows.map((r) => [r.date, r]))
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

function prevMonth(): void {
  if (month.value === 1) {
    year.value -= 1
    month.value = 12
  } else {
    month.value -= 1
  }
}

function nextMonth(): void {
  if (month.value === 12) {
    year.value += 1
    month.value = 1
  } else {
    month.value += 1
  }
}

function selectDay(cell: Cell): void {
  if (cell.day !== null) selectedDay.value = cell.key
}

watch([year, month], () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="calendar-view" v-loading="loading">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">销售日历</h3>
        <div class="actions">
          <el-button @click="prevMonth">‹ 上月</el-button>
          <span class="ym">{{ year }} 年 {{ month }} 月</span>
          <el-button @click="nextMonth">下月 ›</el-button>
          <span class="month-total">当月合计：¥{{ monthTotal.toFixed(2) }}</span>
        </div>
      </div>

      <div class="week-header">
        <div v-for="(w, i) in ['一','二','三','四','五','六','日']" :key="i" class="week-cell">{{ w }}</div>
      </div>

      <div class="grid">
        <div
          v-for="cell in cells"
          :key="cell.key"
          class="cell"
          :class="{ empty: cell.day === null, today: cell.key === selectedDay, weekend: cell.weekday >= 5 }"
          @click="selectDay(cell)"
        >
          <template v-if="cell.day !== null">
            <div class="day-num">{{ cell.day }}</div>
            <div v-if="cell.info" class="amount">¥{{ cell.info.amount.toFixed(2) }}</div>
            <div v-if="cell.info" class="count">{{ cell.info.count }} 单</div>
          </template>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.calendar-view .toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.calendar-view .title {
  margin: 0;
}
.calendar-view .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.calendar-view .ym {
  font-size: 16px;
  font-weight: 600;
  min-width: 110px;
  text-align: center;
}
.calendar-view .month-total {
  color: var(--el-color-primary);
  font-weight: 600;
  margin-left: 12px;
}
.calendar-view .week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.calendar-view .week-cell {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 4px 0;
}
.calendar-view .grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.calendar-view .cell {
  min-height: 84px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
}
.calendar-view .cell.empty {
  background: var(--el-fill-color-lighter);
  cursor: default;
}
.calendar-view .cell.today {
  border-color: var(--el-color-primary);
}
.calendar-view .cell.weekend .day-num {
  color: var(--el-color-danger);
}
.calendar-view .day-num {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.calendar-view .amount {
  margin-top: 8px;
  font-weight: 600;
  color: var(--el-color-primary);
  font-size: 14px;
}
.calendar-view .count {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
