export interface Bindings extends CloudflareBindings {
  /** 管理端 Token（通过 .dev.vars / wrangler secret 配置） */
  ADMIN_TOKEN: string
}

export type CardStatus = 'unused' | 'active' | 'expired' | 'disabled'

export interface CardKey {
  id: number
  key: string
  valid_days: number
  max_devices: number
  status: CardStatus
  note: string | null
  activated_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

export interface DeviceBinding {
  id: number
  card_id: number
  device_id: string
  bound_at: number
  last_seen_at: number
}

export interface VerifyLog {
  id: number
  card_id: number | null
  key: string
  device_id: string
  result: string
  created_at: number
}

export type AnnouncementType = 'normal' | 'client_update' | 'site_config'

export interface Announcement {
  id: number
  title: string
  content: string
  type: AnnouncementType
  download_url: string | null
  pinned: number
  starts_at: number | null
  ends_at: number | null
  created_at: number
  updated_at: number
}

export interface SiteConfig {
  id: number
  title: string
  version: string
  file_url: string | null
  description: string
  created_at: number
  updated_at: number
}

export interface Stats {
  total: number
  unused: number
  active: number
  expired: number
  disabled: number
  bindings: number
  verifies_today: number
}
