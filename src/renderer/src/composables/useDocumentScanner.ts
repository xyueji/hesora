import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi } from '../api/product'
import type { Product } from '../../../shared/types/product'

/**
 * 条码/关键字解析商品的统一入口（收银手输框与单据页全局扫码共用）：
 * 1) 条码精确匹配；2) keyword 查询——唯一命中即返回，
 * 多命中抛错（提示输入完整编码/条码），无命中且名字/编码不匹配返回 null。
 */
export async function resolveScannedProduct(keyword: string): Promise<Product | null> {
  const scanned = await productApi.getByBarcode(keyword)
  if (scanned) return scanned
  const r = await productApi.query({ page: 1, pageSize: 2, keyword })
  if (r.total > 1) throw new Error('匹配到多个商品，请输入完整编码或条码')
  const product = r.list[0]
  if (!product) return null
  // 商品名支持关键字，条码仅精确匹配。
  const query = keyword.toLocaleLowerCase()
  return product.code.toLocaleLowerCase() === query || product.name.toLocaleLowerCase().includes(query)
    ? product
    : null
}

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
      const product = await resolveScannedProduct(code)
      if (product) {
        options.onProduct(product)
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
