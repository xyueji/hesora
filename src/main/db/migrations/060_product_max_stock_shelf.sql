-- 禾序进销存 060: 安全库存上限 / 货架号
--
-- product.max_stock：安全库存上限（超储预警阈值；NULL 表示不设上限、不预警超储）
-- product.shelf_no：货架号（商品批量修改支持字段）

ALTER TABLE product ADD COLUMN max_stock REAL;
ALTER TABLE product ADD COLUMN shelf_no TEXT;
