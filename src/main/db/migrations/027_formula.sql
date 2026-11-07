-- 禾序进销存 027: 独立配方档案
--
-- 配方此前绑死在组合商品的 BOM（bom_item）上，无法复用/版本化。本迁移引入独立配方主档：
-- formula / formula_item。组装单可选用配方代替 BOM 计算子件用量（assemble.service）；
-- BOM 逻辑保持不变，向后兼容。
-- output_product_id 指向产出商品（standard 或 combo 均允许——产出组合商品时可用配方
-- 描述"由子件组成组合"的另一种拆解口径）。

CREATE TABLE formula (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  output_product_id INTEGER NOT NULL REFERENCES product(id),
  output_qty REAL NOT NULL DEFAULT 1,
  remark TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE formula_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id INTEGER NOT NULL REFERENCES formula(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  qty REAL NOT NULL,
  UNIQUE(formula_id, product_id)
);

CREATE INDEX idx_formula_item_formula ON formula_item(formula_id);
