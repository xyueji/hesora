DROP INDEX idx_doc_workflow_conversion;
CREATE INDEX idx_doc_workflow_active_source ON doc_workflow(source_id) WHERE status <> 'cancelled';
CREATE INDEX idx_doc_workflow_batch_history ON doc_workflow(source_id, id);
