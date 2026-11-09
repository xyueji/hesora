import type { Database } from 'better-sqlite3'
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BizError } from '../../../shared/result'

/** 附件行（attachment 表） */
export interface AttachmentRow {
  id: number
  doc_id: number
  file_name: string
  file_path: string
  size: number
  created_at: string
  created_by: number
}

/** 允许上传的图片扩展名（离线拍照留证场景） */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

/** save 输入：data 为 base64 字符串（IPC 传输）或 Buffer（服务层直调/测试） */
export interface AttachmentSaveInput {
  doc_id: number
  file_name: string
  data: string | Buffer
  created_by?: number
}

/**
 * 单据图片附件服务（功能：M 级「单据图片附件」，migration 041）。
 * @param db 数据库连接
 * @param attachmentsDir 附件根目录（由 main/index.ts 传入 app.getPath('userData')/attachments，
 *   服务层禁止 import electron）
 */
export function createAttachmentService(db: Database, attachmentsDir: string) {
  mkdirSync(attachmentsDir, { recursive: true })

  function save(input: AttachmentSaveInput): number {
    const docId = Number(input?.doc_id)
    if (!Number.isInteger(docId) || docId <= 0) {
      throw new BizError('VALIDATION', '请先选择要附加图片的单据')
    }
    const doc = db.prepare('SELECT id FROM doc WHERE id = ?').get(docId)
    if (!doc) {
      throw new BizError('NOT_FOUND', `单据不存在（#${docId}），无法附加图片`)
    }
    const fileName = String(input?.file_name ?? '').trim()
    if (!fileName) {
      throw new BizError('VALIDATION', '请提供图片文件名')
    }
    const extName = extname(fileName).toLowerCase()
    if (!ALLOWED_EXT.has(extName)) {
      throw new BizError('VALIDATION', '仅支持图片附件（png/jpg/jpeg/gif/webp/bmp）')
    }
    let bytes: Buffer
    if (Buffer.isBuffer(input.data)) {
      bytes = input.data
    } else if (typeof input.data === 'string' && input.data.length > 0) {
      bytes = Buffer.from(input.data, 'base64')
    } else {
      throw new BizError('VALIDATION', '附件内容为空')
    }
    if (bytes.length === 0) {
      throw new BizError('VALIDATION', '附件内容为空')
    }
    // 文件名用 uuid 防冲突，保留原始扩展名；file_path 存相对 attachments 根目录的路径
    const filePath = `${randomUUID()}${extName}`
    writeFileSync(join(attachmentsDir, filePath), bytes)
    try {
      const result = db
        .prepare(
          'INSERT INTO attachment (doc_id, file_name, file_path, size, created_by) VALUES (?, ?, ?, ?, ?)'
        )
        .run(docId, fileName, filePath, bytes.length, Number(input.created_by ?? 0))
      return Number(result.lastInsertRowid)
    } catch (e) {
      // 插行失败回滚已写文件，避免留下无记录的孤儿文件
      try {
        unlinkSync(join(attachmentsDir, filePath))
      } catch {
        /* 文件清理失败可忽略（下次启动可按目录清理） */
      }
      throw e
    }
  }

  function listByDoc(docId: number): AttachmentRow[] {
    return db
      .prepare('SELECT * FROM attachment WHERE doc_id = ? ORDER BY id ASC')
      .all(Number(docId)) as AttachmentRow[]
  }

  function getRow(id: number): AttachmentRow {
    const row = db.prepare('SELECT * FROM attachment WHERE id = ?').get(Number(id)) as
      | AttachmentRow
      | undefined
    if (!row) {
      throw new BizError('NOT_FOUND', `附件不存在或已删除（#${id}）`)
    }
    return row
  }

  /** 读取附件内容，返回 base64（经 IPC 展示）与原始文件名 */
  function read(id: number): { file_name: string; data: string } {
    const row = getRow(id)
    const abs = join(attachmentsDir, row.file_path)
    if (!existsSync(abs)) {
      throw new BizError('NOT_FOUND', `附件文件已丢失（${row.file_name}）`)
    }
    return { file_name: row.file_name, data: readFileSync(abs).toString('base64') }
  }

  /** 删除附件：删文件 + 删行 */
  function remove(id: number): void {
    const row = getRow(id)
    db.prepare('DELETE FROM attachment WHERE id = ?').run(row.id)
    try {
      unlinkSync(join(attachmentsDir, row.file_path))
    } catch {
      /* 文件已不存在则忽略 */
    }
  }

  return { save, listByDoc, read, remove }
}
