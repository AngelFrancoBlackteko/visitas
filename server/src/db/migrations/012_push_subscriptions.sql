-- @no-tx
-- v1.12 — browser push notifications (Web Push) for hosts.
--
-- A host opens visitas.world on their phone, taps "Get alerts on this
-- device", and the browser hands us a push subscription. One row per
-- device. When a visitor signs in for that host, the server sends an
-- encrypted push through the browser vendor's push service (Google, Apple,
-- Mozilla, Microsoft). No third-party account is needed.
--
-- notifications_log gains kind 'push'. SQLite can't alter a CHECK
-- constraint in place, so the table is rebuilt.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE notifications_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'sms', 'push')),
  event TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

INSERT INTO notifications_log_new (id, kind, event, recipient, subject, status, error, created_at, sent_at)
  SELECT id, kind, event, recipient, subject, status, error, created_at, sent_at FROM notifications_log;

DROP TABLE notifications_log;
ALTER TABLE notifications_log_new RENAME TO notifications_log;

CREATE INDEX idx_notifications_log_created ON notifications_log(created_at DESC);
CREATE INDEX idx_notifications_log_status  ON notifications_log(status);
CREATE INDEX idx_notifications_log_event   ON notifications_log(event);

COMMIT;

PRAGMA foreign_keys = ON;
