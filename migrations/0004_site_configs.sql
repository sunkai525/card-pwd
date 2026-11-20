-- 站点配置：客户端拉取的最新配置（标题 / 版本号 / 文件地址 / 描述）
CREATE TABLE IF NOT EXISTS site_configs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  version     TEXT    NOT NULL,
  file_url    TEXT,
  description TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_configs_latest ON site_configs(id DESC);
