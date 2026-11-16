-- 卡密主表
CREATE TABLE IF NOT EXISTS card_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,
  valid_days   INTEGER NOT NULL CHECK (valid_days > 0),
  max_devices  INTEGER NOT NULL CHECK (max_devices > 0),
  status       TEXT    NOT NULL DEFAULT 'unused'
                       CHECK (status IN ('unused', 'active', 'expired', 'disabled')),
  note         TEXT,
  activated_at INTEGER,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_keys_status ON card_keys(status);
CREATE INDEX IF NOT EXISTS idx_card_keys_created_at ON card_keys(created_at DESC);

-- 设备绑定表
CREATE TABLE IF NOT EXISTS device_bindings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  device_id     TEXT    NOT NULL,
  bound_at      INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (card_id, device_id),
  FOREIGN KEY (card_id) REFERENCES card_keys(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_bindings_card ON device_bindings(card_id);

-- 校验日志表（审计）
CREATE TABLE IF NOT EXISTS verify_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER,
  key         TEXT    NOT NULL,
  device_id   TEXT    NOT NULL,
  result      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verify_logs_card ON verify_logs(card_id);
CREATE INDEX IF NOT EXISTS idx_verify_logs_created ON verify_logs(created_at DESC);
