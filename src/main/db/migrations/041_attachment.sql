-- 禾序进销存 041: attachment — 单据图片附件（离线拍照留证）
--
-- 图片文件本体存放在 app.getPath('userData')/attachments/ 目录（由 main/index.ts 注入目录），
-- 数据库只存相对文件路径 file_path（相对 attachments 根目录），避免绝对路径迁移失效。
-- created_by 记录上传操作人 user.id（无用户体系前为 0）。

CREATE TABLE attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES doc(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_attachment_doc ON attachment(doc_id);
