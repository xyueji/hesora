CREATE TABLE doc_workflow (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quote','sale_order','purchase_order','sale','purchase')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  body TEXT NOT NULL CHECK (json_valid(body)),
  source_id INTEGER REFERENCES doc_workflow(id),
  posted_doc_id INTEGER UNIQUE REFERENCES doc(id),
  approved_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doc_workflow_conversion ON doc_workflow(source_id) WHERE status <> 'cancelled';
CREATE INDEX idx_cost_log_source_doc ON cost_log(source, source_id);

CREATE TABLE doc_workflow_event (
  id INTEGER PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES doc_workflow(id),
  action TEXT NOT NULL CHECK (action IN ('created','edited','approved','cancelled','converted')),
  operator_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
