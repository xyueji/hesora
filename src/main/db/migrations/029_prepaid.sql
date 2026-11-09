-- 029: 预存款管理（P1 功能差距 #2）
--
-- partner.prepaid：客户/供应商预存款余额。收款单 charge_type='prepaid' 时
-- 金额计入此列（不计入核销）；销售/零售单可用预存款抵扣货款（扣减此列）。
-- doc.charge_type：仅收付款类单据（receipt/payment）使用，'normal' 默认直接核销，
-- 'prepaid' 表示计入预存款（不写 payment_allocation）。
-- doc.prepaid_amount：销售/零售单使用预存款抵扣的金额（0 = 未使用）。
ALTER TABLE customer ADD COLUMN prepaid REAL NOT NULL DEFAULT 0;
ALTER TABLE supplier ADD COLUMN prepaid REAL NOT NULL DEFAULT 0;
ALTER TABLE doc ADD COLUMN charge_type TEXT NOT NULL DEFAULT 'normal'
  CHECK (charge_type IN ('normal','prepaid','prepaid_refund'));
ALTER TABLE doc ADD COLUMN prepaid_amount REAL NOT NULL DEFAULT 0;

CREATE INDEX idx_doc_charge_type ON doc(charge_type) WHERE charge_type <> 'normal';
