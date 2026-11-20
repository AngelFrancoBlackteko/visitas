-- @no-tx
-- v1.13 — 'host' role.
--
-- Until now every person a visitor could ask for was an admin, so every
-- host could see every visitor and change any setting. A 'host' can only
-- sign in, see their own visits and get alerts. Existing users keep their
-- role; admins promote or demote from Users.
--
-- Widening the CHECK constraint needs a table rebuild (same dance as 002).

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ad')),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'security', 'host')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, username, email, display_name, password_hash, source, role, must_change_password, active, phone, created_at, updated_at)
SELECT id, username, email, display_name, password_hash, source, role, must_change_password, active, phone, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

COMMIT;

PRAGMA foreign_keys = ON;
