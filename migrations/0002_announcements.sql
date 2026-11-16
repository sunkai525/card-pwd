-- 公告表
-- starts_at 为空表示立即生效，ends_at 为空表示长期有效
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  starts_at  INTEGER,
  ends_at    INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_announcements_order ON announcements(pinned DESC, created_at DESC);
