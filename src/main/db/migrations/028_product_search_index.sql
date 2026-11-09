-- 商品搜索索引：万级商品下 keyword LIKE 查询的性能兜底。
-- product.service.query 的 keyword 条件为
--   code LIKE @kw OR name LIKE @kw OR id IN (SELECT product_id FROM product_barcode WHERE barcode LIKE @kw)
-- LIKE '%x%' 无法直接用 B-tree 索引，但 code/name 的前缀查询（最常见的
-- 编码/名称开头搜索）可借 idx 前缀扫描；barcode 子查询走 idx_product_barcode。
CREATE INDEX IF NOT EXISTS idx_product_code ON product(code);
CREATE INDEX IF NOT EXISTS idx_product_name ON product(name);
-- barcode LIKE '%kw%' 走全表；普通条码精确/前缀扫描由该索引覆盖。
CREATE INDEX IF NOT EXISTS idx_product_barcode_bc ON product_barcode(barcode);
