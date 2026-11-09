-- 禾序进销存 050: P2 功能批次（单据审核位 + 盘点复盘 + 打印设备绑定）
--
-- doc 表补充：
--   reviewed_by  直过账单据补审核操作人（管理标记，不回滚账务）
--   reviewed_at  补审核时间
--   review_by    盘点复盘操作人
--   review_at    盘点复盘时间
--   review_remark 盘点复盘备注
-- print_template 表补充：
--   device_name  绑定打印机设备名（打印时优先使用）

ALTER TABLE doc ADD COLUMN reviewed_by TEXT;
ALTER TABLE doc ADD COLUMN reviewed_at TEXT;
ALTER TABLE doc ADD COLUMN review_by TEXT;
ALTER TABLE doc ADD COLUMN review_at TEXT;
ALTER TABLE doc ADD COLUMN review_remark TEXT;
ALTER TABLE print_template ADD COLUMN device_name TEXT;
