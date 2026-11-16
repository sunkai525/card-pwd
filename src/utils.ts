import type { AnnouncementType, CardStatus } from './types'

export const ANNOUNCEMENT_TYPES: { value: AnnouncementType; label: string }[] = [
  { value: 'normal', label: '普通公告' },
  { value: 'client_update', label: '客户端版本更新公告' },
  { value: 'site_config', label: '站点配置更新公告' },
]

export function announcementTypeLabel(value: AnnouncementType): string {
  return ANNOUNCEMENT_TYPES.find((t) => t.value === value)?.label ?? '普通公告'
}

export function parseAnnouncementType(v: unknown): AnnouncementType | null {
  return ANNOUNCEMENT_TYPES.some((t) => t.value === v) ? (v as AnnouncementType) : null
}

/** 下载链接校验：仅允许 http/https，空值表示不设置 */
export function parseDownloadUrl(v: unknown): string | null | 'invalid' {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return 'invalid'
  const url = v.trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'invalid'
  } catch {
    return 'invalid'
  }
  return url
}

export const DAY_MS = 24 * 60 * 60 * 1000

export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  let diff = aa.length ^ bb.length
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

// 去掉易混淆字符 O/0/I/1/L
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateKey(prefix = 'CP'): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let body = ''
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length]
  return [
    prefix.toUpperCase(),
    body.slice(0, 4),
    body.slice(4, 8),
    body.slice(8, 12),
    body.slice(12, 16),
  ].join('-')
}

export function remainingDays(expiresAt: number | null): number {
  if (expiresAt == null) return 0
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS))
}

export function displayStatus(status: CardStatus): string {
  return {
    unused: '未激活',
    active: '使用中',
    expired: '已过期',
    disabled: '已禁用',
  }[status]
}

export function formatTime(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
}

export function isNonEmptyString(v: unknown, max = 256): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max
}

export function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 1000000
}

export function parsePositiveInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim())
    if (n > 0) return n
  }
  return fallback
}

export function parseCardStatus(v: unknown): CardStatus | null {
  if (v === 'unused' || v === 'active' || v === 'expired' || v === 'disabled') return v
  return null
}

/** API 时间字段：null 表示清空，'invalid' 表示格式错误 */
export function parseIsoTime(v: unknown): number | null | 'invalid' {
  if (v === null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return 'invalid'
  const t = Date.parse(v)
  return Number.isNaN(t) ? 'invalid' : t
}

/** 表单 datetime-local 值按 UTC 解读（字段标签中标注 UTC） */
export function parseFormTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  let s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00'
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += 'Z'
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

export function isActiveAnnouncement(a: { starts_at: number | null; ends_at: number | null }): boolean {
  const t = Date.now()
  return (a.starts_at == null || a.starts_at <= t) && (a.ends_at == null || a.ends_at >= t)
}

/** 限制 next 参数为站内路径，避免开放重定向 */
export function safeNext(v: unknown): string {
  if (typeof v !== 'string') return '/'
  if (!v.startsWith('/') || v.startsWith('//')) return '/'
  return v
}
