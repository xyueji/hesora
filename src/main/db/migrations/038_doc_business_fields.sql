-- 禾序进销存 038: 单据业务扩展字段（S 级功能批次 B）
--
-- doc 表一次性补充 5 个业务列：
--   external_no     外部订单号（电商平台/线上订单号等，人工录入，允许 NULL）
--   invoice_status  发票状态：'none' 未开票 | 'invoiced' 已开票
--   express_com     快递公司
--   express_no      快递单号
--   delivery_status 发货状态：'none' 未发货 | 'shipped' 已发货
-- 均为 ALTER TABLE ADD COLUMN，runner 按版本号幂等，无需 IF NOT EXISTS。

ALTER TABLE doc ADD COLUMN external_no TEXT;
ALTER TABLE doc ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE doc ADD COLUMN express_com TEXT;
ALTER TABLE doc ADD COLUMN express_no TEXT;
ALTER TABLE doc ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'none';

CREATE INDEX idx_doc_external_no ON doc(external_no) WHERE external_no IS NOT NULL;
