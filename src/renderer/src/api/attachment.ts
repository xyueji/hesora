import { call } from './call'

/** 单据图片附件（离线拍照留证）。文件存 userData/attachments，经 IPC 以 base64 传输。 */
export interface AttachmentRow {
  id: number
  doc_id: number
  file_name: string
  file_path: string
  size: number
  created_at: string
  created_by: number
}

export const attachmentApi = {
  save: (input: { doc_id: number; file_name: string; data: string }) =>
    call<number>('attachment:save', input),
  listByDoc: (docId: number) => call<AttachmentRow[]>('attachment:list', { doc_id: docId }),
  remove: (id: number) => call<void>('attachment:remove', { id }),
  read: (id: number) => call<{ file_name: string; data: string }>('attachment:read', { id })
}
