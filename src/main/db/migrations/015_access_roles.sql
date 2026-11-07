CREATE TABLE access_role (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  permissions TEXT NOT NULL
);

-- Keep legacy built-in roles and user IDs intact. Existing retail-held orders
-- reference the user table, and existing accounts already have a preset role.
ALTER TABLE "user" ADD COLUMN access_role_id TEXT REFERENCES access_role(id) ON DELETE RESTRICT;
CREATE INDEX idx_user_access_role ON "user"(access_role_id);
