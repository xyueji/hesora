-- 禾序进销存 022: fund_flow.partner_id — 退货冲减往来
--
-- 修复已知偏差「销售退货不冲减应收、采购退货不冲减应付」：
-- 退货产生的资金流水（实退分支）此前无往来归属，只能经 doc JOIN 反查。
-- 新增 fund_flow.partner_id 直接记录客户/供应商（散客零售退货为 NULL）；
-- 旧数据该列为 NULL，应收应付计算仍按 doc JOIN 兜底，不受影响。

ALTER TABLE fund_flow ADD COLUMN partner_id INTEGER;
CREATE INDEX idx_fund_flow_partner ON fund_flow(partner_id) WHERE partner_id IS NOT NULL;
