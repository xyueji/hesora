-- 禾序进销存 051: 商品自定义属性
--
-- product_attribute 属性字典表（如 颜色 → 红/蓝）
-- product.attributes 存储 {attr_id: value} JSON 映射

CREATE TABLE product_attribute (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  options TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

ALTER TABLE product ADD COLUMN attributes TEXT;
