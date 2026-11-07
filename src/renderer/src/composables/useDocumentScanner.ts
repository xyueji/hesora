import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi } from '../api/product'
import type { Product } from '../../../shared/types/product'

/**
 * P1-7 单据页扫码：扫码枪连续快速键入 + 回车，把条码解析成商品后交给
 * onProduct 回调（由调用方决定加行还是加数量）。
 * 与 RetailView 的手输框互补：本 composable 监听全局 keydown，
 * 无需焦点在某个输入框——扫码枪任意时刻扫入都能命中。
 *
 * 判定扫码而非键盘录入：字符间隔 < scanGapMs 且以 Enter 结尾，
 * 长度 >= minLength（排除普通的回车提交）。
 */
export interface UseDocumentScannerOptions {
  /** 解析命中后回调（商品已存在） */
  onProduct: (product: Product) => void
  /** 扫到但未命中条码/编码时回调（提示用） */
  onMiss?: (code: string) => void
  /** 是否启用（例如弹窗打开时暂停） */
  enabled?: Ref<boolean>
  scanGapMs?: number
  minLength?: number
}

export function useDocumentScanner(options: UseDocumentScannerOptions): void {
  const gap = options.scanGapMs ?? 50
  const minLength = options.minLength ?? 4
  let buffer = ''
  let lastAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function resolve(code: string): Promise<void> {
    try {
      const scanned = await productApi.getByBarcode(code)
      if (scanned) {
        options.onProduct(scanned)
        return
      }
      const r = await productApi.query({ page: 1, pageSize: 2, keyword: code })
      if (r.total === 1 && r.list[0]) {
        options.onProduct(r.list[0])
        return
      }
      options.onMiss?.(code)
      if (!options.onMiss) ElMessage.warning(`未找到商品：${code}`)
    } catch (e) {
      ElMessage.error((e as Error).message)
    }
  }

  function flush(): void {
    timer = null
    const code = buffer
    buffer = ''
    if (code.length >= minLength) void resolve(code)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (options.enabled && !options.enabled.value) return
    const target = event.target as HTMLElement | null
    // 焦点在可编辑元素时不劫持（避免破坏手输/下拉搜索）
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    const now = Date.now()
    if (now - lastAt > gap) buffer = ''
    lastAt = now
    if (event.key === 'Enter') {
      if (buffer.length >= minLength) {
        event.preventDefault()
        if (timer) clearTimeout(timer)
        flush()
      }
      return
    }
    if (event.key.length === 1) {
      buffer += event.key
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, gap * 10)
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}
