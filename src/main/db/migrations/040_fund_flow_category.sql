-- 禾序进销存 040: fund_flow.category_id — 资金流水关联收支科目（S 级功能批次 B）
--
-- 其他收入/其他支出等资金单据可指定科目（income_category），按科目汇总收支。
-- 允许 NULL（历史数据与未选科目的单据，汇总时归入"未分类"）。

ALTER TABLE fund_flow ADD COLUMN category_id INTEGER REFERENCES income_category(id);

CREATE INDEX idx_fund_flow_category ON fund_flow(category_id) WHERE category_id IS NOT NULL;
