-- 禾序进销存 039: 客商联系与分类字段（S 级功能批次 B）
--
-- customer / supplier 补充：
--   email    电子邮箱（允许 NULL，格式校验由服务层负责）
--   category 分类（自由文本，前端 datalist 建议值：普通/批发/VIP；空串表示未分类）
-- 注意：并行批次可能也在改客商表（如 prepaid 列），本文件只追加以下两列，互不覆盖。

ALTER TABLE customer ADD COLUMN email TEXT;
ALTER TABLE customer ADD COLUMN category TEXT NOT NULL DEFAULT '';

ALTER TABLE supplier ADD COLUMN email TEXT;
ALTER TABLE supplier ADD COLUMN category TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_customer_category ON customer(category) WHERE category <> '';
CREATE INDEX idx_supplier_category ON supplier(category) WHERE category <> '';
