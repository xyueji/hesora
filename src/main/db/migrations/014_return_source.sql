ALTER TABLE doc ADD COLUMN source_doc_id INTEGER REFERENCES doc(id);
CREATE INDEX idx_doc_source ON doc(source_doc_id) WHERE source_doc_id IS NOT NULL;
