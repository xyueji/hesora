-- 禾序进销存 070: 让利闭环（整单优惠 / 核销优惠）
--
-- doc.preferential_amount：整单优惠（立减 + 开单抹零差额）留存口径：
--   total_amount = 商品合计（折扣后） − preferential_amount，应收/核销按 total_amount。
-- payment_allocation.preferential：本次核销时的让利金额（核销金额 + 优惠 = 本次销账金额）。

ALTER TABLE doc ADD COLUMN preferential_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE payment_allocation ADD COLUMN preferential REAL NOT NULL DEFAULT 0;
