-- 083: 备份 v2 元数据表（加密备份描述与恢复线索）
CREATE TABLE IF NOT EXISTS backup_v2 (
  backup_id  TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  meta_json  TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL
);
