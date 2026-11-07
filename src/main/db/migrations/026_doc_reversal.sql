-- 禾序进销存 026: 已过账单据红冲（负向镜像单）
--
-- 差距 5：错单不再只能人工做反向单据，一键生成全额负向镜像单。
-- reversal_of 指向被红冲的原单；一张原单最多一张红冲单（部分唯一索引保证）。
-- 注：曾计划用 024，但 025 已发布，后插入的 024 会被 migrate.ts 的
-- user_version 顺序检查跳过（version <= current），故顺延为 026。

ALTER TABLE doc ADD COLUMN reversal_of INTEGER REFERENCES doc(id);
CREATE UNIQUE INDEX idx_doc_reversal_of ON doc(reversal_of) WHERE reversal_of IS NOT NULL;
