-- zhjs-erp 003: BOM / combo products
ALTER TABLE product ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','combo'));

CREATE TABLE bom_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL REFERENCES product(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  qty REAL NOT NULL DEFAULT 1,
  UNIQUE(combo_id, product_id)
);

CREATE INDEX idx_bom_combo ON bom_item(combo_id);
