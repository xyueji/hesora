import { computed, ref, watch } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'

// 多标签页（Tab）状态：每个已打开页面一个标签，切换标签即路由跳转，组件由 keep-alive 缓存。
export interface AppTab {
  /** 唯一标识：使用路由匹配到的路径模式（/product/edit/:id?），保证同一页面复用同一个标签 */
  key: string
  /** 标签标题（来自路由 meta.title） */
  title: string
  /** 完整路径（含 query），点击标签时跳转 */
  path: string
  /** 是否可关闭（首页固定不可关闭） */
  closable: boolean
}

const STORAGE_KEY = 'hesora.tabs'

export const tabs = ref<AppTab[]>([])
export const activeKey = ref('')
function readStorage(): AppTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is AppTab =>
        !!t && typeof t === 'object' && typeof (t as AppTab).key === 'string' && typeof (t as AppTab).path === 'string'
    )
  } catch {
    return []
  }
}

function writeStorage(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.value))
  } catch {
    /* 忽略存储异常（隐私模式等） */
  }
}

/** 取路由匹配到的路径模式作为标签标识。 */
export function tabKeyOf(route: RouteLocationNormalized): string {
  const matched = route.matched[route.matched.length - 1]
  const pattern = matched?.path
  if (!pattern) return route.path
  // 模式含动态段时统一收敛到同一标签
  return pattern
}

function titleOf(route: RouteLocationNormalized): string {
  const meta = route.meta as { title?: unknown }
  if (typeof meta.title === 'string' && meta.title) return meta.title
  return typeof route.name === 'string' ? route.name : '页面'
}

export function openTab(route: RouteLocationNormalized): void {
  const key = tabKeyOf(route)
  const title = titleOf(route)
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) {
    existing.path = route.fullPath
    existing.title = title
  } else {
    tabs.value.push({
      key,
      title,
      path: route.fullPath,
      closable: key !== '/'
    })
  }
  activeKey.value = key
  writeStorage()
}

export function closeTab(key: string): AppTab | null {
  const idx = tabs.value.findIndex((t) => t.key === key)
  if (idx < 0) return null
  const target = tabs.value[idx]
  if (!target || !target.closable) return null
  tabs.value.splice(idx, 1)
  writeStorage()
  return target
}

export function closeOthers(key: string): void {
  tabs.value = tabs.value.filter((t) => t.key === key || !t.closable)
  writeStorage()
}

export function closeAll(): void {
  tabs.value = tabs.value.filter((t) => !t.closable)
  writeStorage()
}

export function restoreTabs(): void {
  if (tabs.value.length > 0) return
  tabs.value = readStorage()
}

/** 标签页标题（供浏览器窗口标题使用） */
export const currentTitle = computed(() => tabs.value.find((t) => t.key === activeKey.value)?.title ?? '')

watch(activeKey, () => writeStorage())

export function useTabs() {
  return {
    tabs,
    activeKey,
    currentTitle,
    openTab,
    closeTab,
    closeOthers,
    closeAll,
    restoreTabs
  }
}
