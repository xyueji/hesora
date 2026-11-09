import type { Database } from 'better-sqlite3'
import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BizError } from '../../../shared/result'

export type DB = Database

/** 允许上传的商品图片扩展名 */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

/** P3：每个商品最多图片张数 */
export const MAX_PRODUCT_IMAGES = 3

/** save 输入：data 为 base64 字符串（IPC 传输）或 Buffer（服务层直调/测试） */
export interface ProductImageSaveInput {
  product_id: number
  file_name: string
  data: string | Buffer
}

/**
 * 商品图片服务（P3「商品图片 1-3 张」）：
 * 图片文件写入 imagesDir（main/index.ts 注入 userData/product-images，服务层禁止 import electron），
 * product.images 列存相对文件名 JSON 数组（复用 001_init 既有列），主图 = 第 1 张。
 */
export function createProductImageService(db: DB, imagesDir: string) {
  mkdirSync(imagesDir, { recursive: true })

  function imagesOf(productId: number): string[] {
    const row = db.prepare('SELECT images FROM product WHERE id = ?').get(productId) as
      | { images: string | null }
      | undefined
    if (!row) throw new BizError('NOT_FOUND', `商品不存在：${productId}`)
    if (!row.images) return []
    try {
      const parsed: unknown = JSON.parse(row.images)
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      /* corrupted json treated as empty */
    }
    return []
  }

  function setImages(productId: number, images: string[]): void {
    db.prepare('UPDATE product SET images = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(
      images.length ? JSON.stringify(images) : null,
      productId
    )
  }

  return {
    /** 追加一张图片（超过 3 张拒绝），返回存储的相对文件名 */
    save(input: ProductImageSaveInput): string {
      const productId = Number(input?.product_id)
      if (!Number.isInteger(productId) || productId <= 0) {
        throw new BizError('VALIDATION', '请先选择商品')
      }
      const current = imagesOf(productId)
      if (current.length >= MAX_PRODUCT_IMAGES) {
        throw new BizError('VALIDATION', `每个商品最多上传 ${MAX_PRODUCT_IMAGES} 张图片`)
      }
      const fileName = String(input?.file_name ?? '').trim()
      if (!fileName) throw new BizError('VALIDATION', '请提供图片文件名')
      const extName = extname(fileName).toLowerCase()
      if (!ALLOWED_EXT.has(extName)) {
        throw new BizError('VALIDATION', '仅支持图片（png/jpg/jpeg/gif/webp/bmp）')
      }
      let bytes: Buffer
      if (Buffer.isBuffer(input.data)) {
        bytes = input.data
      } else if (typeof input.data === 'string' && input.data.length > 0) {
        bytes = Buffer.from(input.data, 'base64')
      } else {
        throw new BizError('VALIDATION', '图片内容为空')
      }
      if (bytes.length === 0) throw new BizError('VALIDATION', '图片内容为空')
      const storedName = `${randomUUID()}${extName}`
      writeFileSync(join(imagesDir, storedName), bytes)
      try {
        setImages(productId, [...current, storedName])
      } catch (e) {
        try {
          unlinkSync(join(imagesDir, storedName))
        } catch {
          /* 清理失败可忽略 */
        }
        throw e
      }
      return storedName
    },

    /** 删除一张图片（按相对文件名）：删文件 + 从数组移除 */
    remove(productId: number, storedName: string): void {
      const current = imagesOf(productId)
      const idx = current.indexOf(storedName)
      if (idx === -1) {
        throw new BizError('NOT_FOUND', `图片不存在：${storedName}`)
      }
      setImages(productId, current.filter((n) => n !== storedName))
      try {
        unlinkSync(join(imagesDir, storedName))
      } catch {
        /* 文件已不存在则忽略 */
      }
    },

    /** 商品图片相对文件名列表（主图 = 第 1 张） */
    list(productId: number): string[] {
      return imagesOf(productId)
    },
    /** 读取图片文件内容（预览用），返回 {mime, data(base64)}；找不到或非法路径抛错 */
    read(storedName: string): { mime: string; data: string } {
      const name = String(storedName ?? '')
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        throw new BizError('VALIDATION', '无效的图片文件名')
      }
      const ext = extname(name).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) throw new BizError('VALIDATION', '不支持的图片格式')
      const MIME: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      }
      try {
        const buf = readFileSync(join(imagesDir, name))
        return { mime: MIME[ext] ?? 'application/octet-stream', data: buf.toString('base64') }
      } catch {
        throw new BizError('NOT_FOUND', '图片文件不存在')
      }
    }
  }
}

export type ProductImageService = ReturnType<typeof createProductImageService>
