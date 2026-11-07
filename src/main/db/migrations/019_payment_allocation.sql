CREATE TABLE payment_allocation (
  payment_id INTEGER NOT NULL REFERENCES doc(id),
  target_doc_id INTEGER NOT NULL REFERENCES doc(id),
  amount REAL NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, target_doc_id),
  CHECK (payment_id <> target_doc_id)
);

CREATE INDEX idx_payment_allocation_target ON payment_allocation(target_doc_id);
