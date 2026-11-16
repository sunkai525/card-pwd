-- 公告类型：normal（普通）/ client_update（客户端版本更新）/ site_config（站点配置更新）
ALTER TABLE announcements ADD COLUMN type TEXT NOT NULL DEFAULT 'normal';

-- 下载链接（可为空）
ALTER TABLE announcements ADD COLUMN download_url TEXT;
