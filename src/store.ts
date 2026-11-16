import type {
  Announcement,
  AnnouncementType,
  Bindings,
  CardKey,
  CardStatus,
  DeviceBinding,
  Stats,
  VerifyLog,
} from './types'
import { DAY_MS } from './utils'

type DB = Bindings['DB']

export async function getCardByKey(db: DB, key: string): Promise<CardKey | null> {
  return (await db.prepare('SELECT * FROM card_keys WHERE key = ?').bind(key).first<CardKey>()) ?? null
}

export async function getCardById(db: DB, id: number): Promise<CardKey | null> {
  return (await db.prepare('SELECT * FROM card_keys WHERE id = ?').bind(id).first<CardKey>()) ?? null
}

export interface ListQuery {
  page: number
  pageSize: number
  status?: CardStatus
  q?: string
}

export async function listCards(
  db: DB,
  { page, pageSize, status, q }: ListQuery,
): Promise<{ items: CardKey[]; total: number }> {
  const where: string[] = []
  const params: (string | number)[] = []
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (q) {
    where.push("(key LIKE ? OR COALESCE(note, '') LIKE ?)")
    params.push(`%${q}%`, `%${q}%`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total =
    (await db.prepare(`SELECT COUNT(*) AS n FROM card_keys ${clause}`).bind(...params).first<{ n: number }>())?.n ?? 0
  const result = await db
    .prepare(`SELECT * FROM card_keys ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all<CardKey>()
  return { items: result.results as CardKey[], total }
}

export async function getBindings(db: DB, cardId: number): Promise<DeviceBinding[]> {
  const result = await db
    .prepare('SELECT * FROM device_bindings WHERE card_id = ? ORDER BY last_seen_at DESC')
    .bind(cardId)
    .all<DeviceBinding>()
  return result.results as DeviceBinding[]
}

export async function getRecentLogs(db: DB, cardId: number, limit = 10): Promise<VerifyLog[]> {
  const result = await db
    .prepare('SELECT * FROM verify_logs WHERE card_id = ? ORDER BY id DESC LIMIT ?')
    .bind(cardId, limit)
    .all<VerifyLog>()
  return result.results as VerifyLog[]
}

export interface NewCard {
  key: string
  valid_days: number
  max_devices: number
  note: string | null
}

/** 批量插入，执行前由调用方去重。返回实际插入条数 */
export async function insertCards(db: DB, cards: NewCard[]): Promise<number> {
  if (cards.length === 0) return 0
  const t = Date.now()
  const statements = cards.map((card) =>
    db
      .prepare(
        `INSERT INTO card_keys (key, valid_days, max_devices, status, note, created_at, updated_at)
         VALUES (?, ?, ?, 'unused', ?, ?, ?)`,
      )
      .bind(card.key, card.valid_days, card.max_devices, card.note, t, t),
  )
  await db.batch(statements)
  return cards.length
}

export async function existingKeys(db: DB, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(',')
    const result = await db
      .prepare(`SELECT key FROM card_keys WHERE key IN (${placeholders})`)
      .bind(...chunk)
      .all<{ key: string }>()
    for (const row of result.results as { key: string }[]) found.add(row.key)
  }
  return found
}

export async function updateCard(
  db: DB,
  id: number,
  fields: Partial<Pick<CardKey, 'valid_days' | 'max_devices' | 'note' | 'status'>>,
): Promise<void> {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (fields.valid_days !== undefined) {
    sets.push('valid_days = ?')
    params.push(fields.valid_days)
  }
  if (fields.max_devices !== undefined) {
    sets.push('max_devices = ?')
    params.push(fields.max_devices)
  }
  if (fields.note !== undefined) {
    sets.push('note = ?')
    params.push(fields.note)
  }
  if (fields.status !== undefined) {
    sets.push('status = ?')
    params.push(fields.status)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(Date.now(), id)
  await db.prepare(`UPDATE card_keys SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()
}

export async function deleteCard(db: DB, id: number): Promise<void> {
  await db.prepare('DELETE FROM card_keys WHERE id = ?').bind(id).run()
}

export async function getCardsByIds(db: DB, ids: number[]): Promise<CardKey[]> {
  const cards: CardKey[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(',')
    const result = await db
      .prepare(`SELECT * FROM card_keys WHERE id IN (${placeholders}) ORDER BY id DESC`)
      .bind(...chunk)
      .all<CardKey>()
    cards.push(...(result.results as CardKey[]))
  }
  return cards
}

/** 批量删除，利用外键级联清除绑定与日志 */
export async function deleteCards(db: DB, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  await db.batch(ids.map((id) => db.prepare('DELETE FROM card_keys WHERE id = ?').bind(id)))
  return ids.length
}

export async function countBindings(db: DB, cardId: number): Promise<number> {
  return (
    (await db
      .prepare('SELECT COUNT(*) AS n FROM device_bindings WHERE card_id = ?')
      .bind(cardId)
      .first<{ n: number }>())?.n ?? 0
  )
}

/**
 * 原子绑定设备：把「检查设备数 + 插入/刷新绑定」合并为一条语句，
 * 避免并发校验时多个请求同时通过上限检查。
 * 返回 false 表示设备数已达上限。
 */
export async function bindDevice(
  db: DB,
  cardId: number,
  deviceId: string,
  maxDevices: number,
  t: number,
): Promise<boolean> {
  const info = await db
    .prepare(
      `INSERT INTO device_bindings (card_id, device_id, bound_at, last_seen_at)
       SELECT ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM device_bindings WHERE card_id = ?) < ?
          OR EXISTS (SELECT 1 FROM device_bindings WHERE card_id = ? AND device_id = ?)
       ON CONFLICT(card_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(cardId, deviceId, t, t, cardId, maxDevices, cardId, deviceId)
    .run()
  return info.meta.changes > 0
}

export async function deleteBinding(db: DB, cardId: number, deviceId: string): Promise<boolean> {
  const info = await db
    .prepare('DELETE FROM device_bindings WHERE card_id = ? AND device_id = ?')
    .bind(cardId, deviceId)
    .run()
  return info.success
}

export async function logVerify(
  db: DB,
  entry: { cardId: number | null; key: string; deviceId: string; result: string; t: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO verify_logs (card_id, key, device_id, result, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(entry.cardId, entry.key, entry.deviceId, entry.result, entry.t)
    .run()
}

export async function getStats(db: DB): Promise<Stats> {
  const counts = await db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) AS unused,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled
       FROM card_keys`,
    )
    .first<{ total: number; unused: number; active: number; expired: number; disabled: number }>()
  const bindings =
    (await db.prepare('SELECT COUNT(*) AS n FROM device_bindings').first<{ n: number }>())?.n ?? 0
  const verifies =
    (await db
      .prepare('SELECT COUNT(*) AS n FROM verify_logs WHERE created_at >= ?')
      .bind(Date.now() - DAY_MS)
      .first<{ n: number }>())?.n ?? 0
  return {
    total: counts?.total ?? 0,
    unused: counts?.unused ?? 0,
    active: counts?.active ?? 0,
    expired: counts?.expired ?? 0,
    disabled: counts?.disabled ?? 0,
    bindings,
    verifies_today: verifies,
  }
}

export async function getRecentVerifies(db: DB, limit = 10): Promise<VerifyLog[]> {
  const result = await db
    .prepare('SELECT * FROM verify_logs ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<VerifyLog>()
  return result.results as VerifyLog[]
}

// ---------------------------------------------------------------------------
// 公告
// ---------------------------------------------------------------------------
export interface AnnouncementInput {
  title: string
  content: string
  type: AnnouncementType
  download_url: string | null
  pinned: number
  starts_at: number | null
  ends_at: number | null
}

const ANNOUNCEMENT_ORDER = 'ORDER BY pinned DESC, COALESCE(starts_at, created_at) DESC'

/** 对外可见：生效时间内且未失效 */
export async function listPublicAnnouncements(db: DB, limit = 50): Promise<Announcement[]> {
  const t = Date.now()
  const result = await db
    .prepare(
      `SELECT * FROM announcements
       WHERE (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
       ${ANNOUNCEMENT_ORDER} LIMIT ?`,
    )
    .bind(t, t, limit)
    .all<Announcement>()
  return result.results as Announcement[]
}

/** 管理端：全部公告（含未生效/已失效） */
export async function listAllAnnouncements(db: DB): Promise<Announcement[]> {
  const result = await db.prepare(`SELECT * FROM announcements ${ANNOUNCEMENT_ORDER}`).all<Announcement>()
  return result.results as Announcement[]
}

export async function getAnnouncementById(db: DB, id: number): Promise<Announcement | null> {
  return (await db.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first<Announcement>()) ?? null
}

export async function insertAnnouncement(db: DB, input: AnnouncementInput): Promise<Announcement | null> {
  const t = Date.now()
  const info = await db
    .prepare(
      `INSERT INTO announcements (title, content, type, download_url, pinned, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.title,
      input.content,
      input.type,
      input.download_url,
      input.pinned,
      input.starts_at,
      input.ends_at,
      t,
      t,
    )
    .run()
  return getAnnouncementById(db, info.meta.last_row_id)
}

export async function updateAnnouncement(
  db: DB,
  id: number,
  input: Partial<AnnouncementInput>,
): Promise<void> {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  for (const field of ['title', 'content', 'type', 'download_url', 'pinned', 'starts_at', 'ends_at'] as const) {
    if (input[field] !== undefined) {
      sets.push(`${field} = ?`)
      params.push(input[field])
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(Date.now(), id)
  await db.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()
}

export async function deleteAnnouncement(db: DB, id: number): Promise<void> {
  await db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run()
}
