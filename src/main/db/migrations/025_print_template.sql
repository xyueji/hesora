-- 禾序进销存 025: 打印模板 print_template
-- 差距 8（简化版）：小票/A4 打印模板的显示开关，content 为 JSON 字符串（boolean 字段开关）。
-- is_default 同 kind 互斥（由 template.service 的 setDefault 事务保证）。
CREATE TABLE print_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'a4')),
  content TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
