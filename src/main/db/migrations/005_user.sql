-- 005: 用户表 user（角色权限）
-- 密码使用 scrypt 哈希（salt:hex 格式），由服务层生成，不在迁移中写入。
-- 默认管理员 admin/admin123 由服务层 ensureDefaultAdmin() 在应用启动时懒创建（仅当无任何用户时）。
CREATE TABLE "user" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin','cashier')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
