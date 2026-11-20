import { Hono } from 'hono'
import type { Context } from 'hono'
import { apiAuth, clearAdminCookie, pageAuth, setAdminCookie, tokenMatches } from './auth'
import * as pages from './pages'
import { renderer } from './renderer'
import * as store from './store'
import type { Bindings, CardStatus } from './types'
import {
  generateKey,
  isNonEmptyString,
  isPositiveInt,
  parseAnnouncementType,
  parseCardStatus,
  parseDownloadUrl,
  parseFormTime,
  parseIsoTime,
  parsePositiveInt,
  safeNext,
} from './utils'
import { verifyCard } from './verify'

type AppEnv = { Bindings: Bindings }
type Body = Record<string, unknown>

const app = new Hono<AppEnv>()
app.use(renderer)

async function readJson(c: Context<AppEnv>): Promise<Body | null> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : null
  } catch {
    return null
  }
}

async function readForm(c: Context<AppEnv>): Promise<Record<string, string>> {
  const body = await c.req.parseBody()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    out[key] = typeof value === 'string' ? value : ''
  }
  return out
}

function formCardConfig(b: Record<string, string>) {
  const validDays = parsePositiveInt(b.valid_days, 0)
  const maxDevices = parsePositiveInt(b.max_devices, 0)
  if (!isPositiveInt(validDays) || !isPositiveInt(maxDevices)) return null
  return {
    valid_days: validDays,
    max_devices: maxDevices,
    note: b.note?.trim() || null,
  }
}

function dedupe(keys: string[]): string[] {
  return [...new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0))]
}

type AnnouncementFields = Partial<store.AnnouncementInput>

function parseAnnouncementBody(body: Body, requireAll: boolean): { fields: AnnouncementFields; error?: string } {
  const fields: AnnouncementFields = {}
  if (requireAll || body.title !== undefined) {
    if (!isNonEmptyString(body.title, 200)) return { fields, error: 'title 无效' }
    fields.title = (body.title as string).trim()
  }
  if (requireAll || body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20000) {
      return { fields, error: 'content 无效' }
    }
    fields.content = body.content.trim()
  }
  if (body.type !== undefined) {
    const type = parseAnnouncementType(body.type)
    if (!type) return { fields, error: 'type 必须为 normal/client_update/site_config' }
    fields.type = type
  } else if (requireAll) {
    fields.type = 'normal'
  }
  if (body.download_url !== undefined) {
    const url = parseDownloadUrl(body.download_url)
    if (url === 'invalid') return { fields, error: 'download_url 必须为有效的 http/https 地址' }
    fields.download_url = url
  } else if (requireAll) {
    fields.download_url = null
  }
  if (body.pinned !== undefined) {
    if (body.pinned !== true && body.pinned !== false && body.pinned !== 0 && body.pinned !== 1) {
      return { fields, error: 'pinned 必须为布尔值或 0/1' }
    }
    fields.pinned = body.pinned === true || body.pinned === 1 ? 1 : 0
  } else if (requireAll) {
    fields.pinned = 0
  }
  for (const key of ['starts_at', 'ends_at'] as const) {
    if (body[key] === undefined) {
      if (requireAll) fields[key] = null
      continue
    }
    const parsed = parseIsoTime(body[key])
    if (parsed === 'invalid') return { fields, error: `${key} 时间格式错误` }
    fields[key] = parsed
  }
  if (fields.starts_at != null && fields.ends_at != null && fields.ends_at <= fields.starts_at) {
    return { fields, error: '失效时间必须晚于生效时间' }
  }
  return { fields }
}

function parseAnnouncementForm(form: Record<string, string>): store.AnnouncementInput | null {
  const title = form.title?.trim()
  const content = form.content?.trim()
  if (!title || title.length > 200 || !content) return null
  const starts_at = parseFormTime(form.starts_at)
  const ends_at = parseFormTime(form.ends_at)
  if (starts_at != null && ends_at != null && ends_at <= starts_at) return null
  const download_url = parseDownloadUrl(form.download_url)
  if (download_url === 'invalid') return null
  return {
    title,
    content,
    type: parseAnnouncementType(form.type) ?? 'normal',
    download_url,
    pinned: form.pinned === '1' ? 1 : 0,
    starts_at,
    ends_at,
  }
}

type SiteConfigFields = Partial<store.SiteConfigInput>

function parseSiteConfigBody(body: Body, requireAll: boolean): { fields: SiteConfigFields; error?: string } {
  const fields: SiteConfigFields = {}
  if (requireAll || body.title !== undefined) {
    if (!isNonEmptyString(body.title, 200)) return { fields, error: 'title 无效' }
    fields.title = (body.title as string).trim()
  }
  if (requireAll || body.version !== undefined) {
    if (!isNonEmptyString(body.version, 100)) return { fields, error: 'version 无效' }
    fields.version = (body.version as string).trim()
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 100000) {
      return { fields, error: 'description 无效' }
    }
    fields.description = body.description.trim()
  } else if (requireAll) {
    fields.description = ''
  }
  if (body.file_url !== undefined) {
    const url = parseDownloadUrl(body.file_url)
    if (url === 'invalid') return { fields, error: 'file_url 必须为有效的 http/https 地址' }
    fields.file_url = url
  } else if (requireAll) {
    fields.file_url = null
  }
  return { fields }
}

function parseSiteConfigForm(form: Record<string, string>): store.SiteConfigInput | null {
  const title = form.title?.trim()
  const version = form.version?.trim()
  if (!title || title.length > 200 || !version || version.length > 100) return null
  const description = form.description?.trim() ?? ''
  if (description.length > 100000) return null
  const file_url = parseDownloadUrl(form.file_url)
  if (file_url === 'invalid') return null
  return { title, version, file_url, description }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function readUploadedFile(form: FormData): { file?: File; error?: string } {
  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return { error: '缺少文件' }
  if (file.size === 0) return { error: '文件不能为空' }
  if (file.size > MAX_UPLOAD_BYTES) return { error: '文件不能超过 10 MB' }
  return { file }
}

/** 上传到 R2 并返回可由 /files/<key> 代理访问的绝对地址 */
async function uploadR2File(c: Context<AppEnv>, file: File): Promise<string> {
  const ext = /\.[a-zA-Z0-9]{1,10}$/.exec(file.name)?.[0] ?? ''
  const key = `${Date.now()}-${crypto.randomUUID()}${ext}`
  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })
  return new URL(`/files/${encodeURIComponent(key)}`, c.req.url).toString()
}

async function readFormIds(c: Context<AppEnv>): Promise<number[]> {
  // all: true —— 同名复选框/隐藏字段需要保留为数组，否则只取到最后一个
  const body = await c.req.parseBody({ all: true })
  const raw = body.ids
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
}

// ---------------------------------------------------------------------------
// 对外校验 API（无需鉴权）
// ---------------------------------------------------------------------------
app.post('/api/verify', async (c) => {
  const body = await readJson(c)
  if (!body || !isNonEmptyString(body.key, 256) || !isNonEmptyString(body.device_id, 128)) {
    return c.json({ valid: false, code: 'BAD_REQUEST', message: 'key 与 device_id 必填' }, 400)
  }
  const result = await verifyCard(c.env.DB, (body.key as string).trim(), (body.device_id as string).trim())
  return c.json(result)
})

// 对外公告 API（无需鉴权，仅返回生效期内的公告）
app.get('/api/announcements', async (c) => {
  // 非法 type 视为不过滤，与 /api/admin/keys 的 status 参数行为一致
  const type = parseAnnouncementType(c.req.query('type')) ?? undefined
  return c.json({ items: await store.listPublicAnnouncements(c.env.DB, 50, type) })
})

// 对外站点配置 API（无需管理 Token，但需通过卡密校验；校验通过后返回最新一条）
app.get('/api/site-config', async (c) => {
  const key = c.req.query('key')
  const deviceId = c.req.query('device_id')
  if (!isNonEmptyString(key, 256) || !isNonEmptyString(deviceId, 128)) {
    return c.json({ valid: false, code: 'BAD_REQUEST', message: 'key 与 device_id 必填' }, 400)
  }
  const result = await verifyCard(c.env.DB, key.trim(), deviceId.trim())
  if (!result.valid) return c.json(result)
  return c.json({ valid: true, config: await store.getLatestSiteConfig(c.env.DB) })
})

// R2 文件代理：上传接口返回的文件地址指向这里
app.get('/files/:key', async (c) => {
  let key = c.req.param('key')
  try {
    key = decodeURIComponent(key)
  } catch {
    // 原样使用
  }
  const object = await c.env.FILES.get(key)
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  return new Response(object.body, { headers })
})

// ---------------------------------------------------------------------------
// 管理 API（Bearer Token 鉴权）
// ---------------------------------------------------------------------------
app.use('/api/admin/*', apiAuth)

app.get('/api/admin/stats', async (c) => {
  return c.json(await store.getStats(c.env.DB))
})

app.get('/api/admin/announcements', async (c) => {
  return c.json({ items: await store.listAllAnnouncements(c.env.DB) })
})

app.post('/api/admin/announcements', async (c) => {
  const body = await readJson(c)
  if (!body) return c.json({ error: 'BAD_REQUEST' }, 400)
  const { fields, error } = parseAnnouncementBody(body, true)
  if (error || !fields.title || !fields.content) {
    return c.json({ error: 'BAD_REQUEST', message: error ?? '标题和内容必填' }, 400)
  }
  return c.json({ announcement: await store.insertAnnouncement(c.env.DB, fields as store.AnnouncementInput) }, 201)
})

app.patch('/api/admin/announcements/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await store.getAnnouncementById(c.env.DB, id)
  if (!existing) return c.json({ error: 'NOT_FOUND' }, 404)
  const body = await readJson(c)
  if (!body) return c.json({ error: 'BAD_REQUEST' }, 400)
  const { fields, error } = parseAnnouncementBody(body, false)
  if (error) return c.json({ error: 'BAD_REQUEST', message: error }, 400)
  const starts = fields.starts_at !== undefined ? fields.starts_at : existing.starts_at
  const ends = fields.ends_at !== undefined ? fields.ends_at : existing.ends_at
  if (starts != null && ends != null && ends <= starts) {
    return c.json({ error: 'BAD_REQUEST', message: '失效时间必须晚于生效时间' }, 400)
  }
  await store.updateAnnouncement(c.env.DB, id, fields)
  return c.json({ announcement: await store.getAnnouncementById(c.env.DB, id) })
})

app.delete('/api/admin/announcements/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await store.getAnnouncementById(c.env.DB, id))) return c.json({ error: 'NOT_FOUND' }, 404)
  await store.deleteAnnouncement(c.env.DB, id)
  return c.json({ deleted: id })
})

// --- 站点配置管理 API ---
app.get('/api/admin/site-configs', async (c) => {
  return c.json({ items: await store.listAllSiteConfigs(c.env.DB) })
})

app.post('/api/admin/site-configs', async (c) => {
  const body = await readJson(c)
  if (!body) return c.json({ error: 'BAD_REQUEST' }, 400)
  const { fields, error } = parseSiteConfigBody(body, true)
  if (error) return c.json({ error: 'BAD_REQUEST', message: error }, 400)
  return c.json({ config: await store.insertSiteConfig(c.env.DB, fields as store.SiteConfigInput) }, 201)
})

app.post('/api/admin/site-configs/upload', async (c) => {
  const { file, error } = readUploadedFile(await c.req.formData())
  if (error || !file) return c.json({ error: 'BAD_REQUEST', message: error ?? '缺少文件' }, 400)
  return c.json({ url: await uploadR2File(c, file) }, 201)
})

app.patch('/api/admin/site-configs/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await store.getSiteConfigById(c.env.DB, id))) return c.json({ error: 'NOT_FOUND' }, 404)
  const body = await readJson(c)
  if (!body) return c.json({ error: 'BAD_REQUEST' }, 400)
  const { fields, error } = parseSiteConfigBody(body, false)
  if (error) return c.json({ error: 'BAD_REQUEST', message: error }, 400)
  await store.updateSiteConfig(c.env.DB, id, fields)
  return c.json({ config: await store.getSiteConfigById(c.env.DB, id) })
})

app.delete('/api/admin/site-configs/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await store.getSiteConfigById(c.env.DB, id))) return c.json({ error: 'NOT_FOUND' }, 404)
  await store.deleteSiteConfig(c.env.DB, id)
  return c.json({ deleted: id })
})

app.get('/api/admin/keys', async (c) => {
  const page = parsePositiveInt(c.req.query('page'), 1)
  const pageSize = Math.min(parsePositiveInt(c.req.query('page_size'), 20), 100)
  const status = parseCardStatus(c.req.query('status')) ?? undefined
  const q = c.req.query('q')?.trim() || undefined
  const { items, total } = await store.listCards(c.env.DB, { page, pageSize, status, q })
  return c.json({ items, total, page, page_size: pageSize })
})

app.post('/api/admin/keys', async (c) => {
  const body = await readJson(c)
  if (
    !body ||
    !isNonEmptyString(body.key, 256) ||
    !isPositiveInt(body.valid_days) ||
    !isPositiveInt(body.max_devices)
  ) {
    return c.json({ error: 'BAD_REQUEST', message: 'key、valid_days、max_devices 无效' }, 400)
  }
  const key = (body.key as string).trim()
  if ((await store.existingKeys(c.env.DB, [key])).size > 0) {
    return c.json({ error: 'DUPLICATE_KEY', message: '卡密已存在' }, 409)
  }
  const note = typeof body.note === 'string' ? body.note.trim() || null : null
  await store.insertCards(c.env.DB, [
    { key, valid_days: body.valid_days, max_devices: body.max_devices, note },
  ])
  return c.json({ created: 1, card: await store.getCardByKey(c.env.DB, key) }, 201)
})

app.post('/api/admin/keys/import', async (c) => {
  const body = await readJson(c)
  if (!body || !isPositiveInt(body.valid_days) || !isPositiveInt(body.max_devices)) {
    return c.json({ error: 'BAD_REQUEST', message: 'valid_days、max_devices 无效' }, 400)
  }
  let keys: string[] = []
  if (Array.isArray(body.keys)) {
    keys = dedupe(body.keys.filter((k): k is string => isNonEmptyString(k, 256)))
  } else if (isPositiveInt(body.count)) {
    const rawPrefix = typeof body.prefix === 'string' ? body.prefix.trim().toUpperCase() : 'CP'
    const prefix = /^[A-Z0-9-]{1,10}$/.test(rawPrefix) ? rawPrefix : 'CP'
    const count = Math.min(body.count, 1000)
    const generated = new Set<string>()
    while (generated.size < count) generated.add(generateKey(prefix))
    keys = [...generated]
  } else {
    return c.json({ error: 'BAD_REQUEST', message: '需提供 keys 数组或 count' }, 400)
  }

  const existing = await store.existingKeys(c.env.DB, keys)
  const toInsert = keys.filter((k) => !existing.has(k))
  const note = typeof body.note === 'string' ? body.note.trim() || null : null
  await store.insertCards(
    c.env.DB,
    toInsert.map((key) => ({
      key,
      valid_days: body.valid_days as number,
      max_devices: body.max_devices as number,
      note,
    })),
  )
  return c.json(
    { created: toInsert.length, skipped: keys.length - toInsert.length, keys: toInsert },
    201,
  )
})

app.get('/api/admin/keys/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.json({ error: 'NOT_FOUND' }, 404)
  const [bindings, logs] = await Promise.all([
    store.getBindings(c.env.DB, id),
    store.getRecentLogs(c.env.DB, id, 20),
  ])
  return c.json({ card, bindings, logs })
})

app.patch('/api/admin/keys/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.json({ error: 'NOT_FOUND' }, 404)
  const body = await readJson(c)
  if (!body) return c.json({ error: 'BAD_REQUEST' }, 400)

  const fields: Parameters<typeof store.updateCard>[2] = {}
  if (body.valid_days !== undefined) {
    if (!isPositiveInt(body.valid_days)) return c.json({ error: 'BAD_REQUEST', message: 'valid_days 无效' }, 400)
    fields.valid_days = body.valid_days
  }
  if (body.max_devices !== undefined) {
    if (!isPositiveInt(body.max_devices)) return c.json({ error: 'BAD_REQUEST', message: 'max_devices 无效' }, 400)
    fields.max_devices = body.max_devices
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') {
      return c.json({ error: 'BAD_REQUEST', message: 'note 无效' }, 400)
    }
    fields.note = body.note === null ? null : (body.note as string).trim() || null
  }
  if (body.status !== undefined) {
    const status = parseCardStatus(body.status)
    if (!status || status === 'expired') {
      return c.json({ error: 'BAD_REQUEST', message: 'status 只能为 unused/active/disabled' }, 400)
    }
    fields.status = status
  }
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') {
      return c.json({ error: 'BAD_REQUEST', message: 'disabled 必须为布尔值' }, 400)
    }
    fields.status = body.disabled
      ? 'disabled'
      : card.activated_at == null
        ? 'unused'
        : card.expires_at && Date.now() > card.expires_at
          ? 'expired'
          : 'active'
  }

  await store.updateCard(c.env.DB, id, fields)
  return c.json({ card: await store.getCardById(c.env.DB, id) })
})

app.delete('/api/admin/keys', async (c) => {
  const body = await readJson(c)
  if (
    !body ||
    !Array.isArray(body.ids) ||
    body.ids.length === 0 ||
    !body.ids.every((id) => Number.isInteger(id) && (id as number) > 0)
  ) {
    return c.json({ error: 'BAD_REQUEST', message: 'ids 必须为非空正整数数组' }, 400)
  }
  const ids = [...new Set(body.ids as number[])].slice(0, 1000)
  const deleted = await store.deleteCards(c.env.DB, ids)
  return c.json({ deleted })
})

app.delete('/api/admin/keys/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await store.getCardById(c.env.DB, id))) return c.json({ error: 'NOT_FOUND' }, 404)
  await store.deleteCard(c.env.DB, id)
  return c.json({ deleted: id })
})

app.delete('/api/admin/keys/:id/devices/:device', async (c) => {
  const id = Number(c.req.param('id'))
  let device = c.req.param('device')
  try {
    device = decodeURIComponent(device)
  } catch {
    // 原样使用
  }
  const removed = await store.deleteBinding(c.env.DB, id, device)
  return c.json({ removed })
})

// ---------------------------------------------------------------------------
// 管理页面（Cookie 鉴权）
// ---------------------------------------------------------------------------
app.get('/login', (c) => {
  return c.render(<pages.LoginPage next={safeNext(c.req.query('next'))} />)
})

app.post('/login', async (c) => {
  const form = await readForm(c)
  const next = safeNext(form.next)
  if (!tokenMatches(c, form.token)) {
    return c.render(<pages.LoginPage error="Token 无效" next={next} />)
  }
  setAdminCookie(c, form.token)
  return c.redirect(next)
})

app.post('/logout', (c) => {
  clearAdminCookie(c)
  return c.redirect('/login')
})

app.get('/', pageAuth, async (c) => {
  const [stats, recentVerifies, recentCards, announcements] = await Promise.all([
    store.getStats(c.env.DB),
    store.getRecentVerifies(c.env.DB, 8),
    store.listCards(c.env.DB, { page: 1, pageSize: 8 }),
    store.listPublicAnnouncements(c.env.DB, 5),
  ])
  return c.render(
    <pages.DashboardPage
      stats={stats}
      recentVerifies={recentVerifies}
      recentCards={recentCards.items}
      announcements={announcements}
    />,
  )
})

app.get('/keys', pageAuth, async (c) => {
  const page = parsePositiveInt(c.req.query('page'), 1)
  const status = (parseCardStatus(c.req.query('status')) ?? '') as CardStatus | ''
  const q = c.req.query('q')?.trim() ?? ''
  const pageSize = 20
  const { items, total } = await store.listCards(c.env.DB, {
    page,
    pageSize,
    status: status || undefined,
    q: q || undefined,
  })
  const deleted = parsePositiveInt(c.req.query('deleted'), 0)
  return c.render(
    <pages.KeysPage
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      status={status}
      q={q}
      message={deleted > 0 ? `已删除 ${deleted} 张卡密` : undefined}
    />,
  )
})

app.get('/keys/new', pageAuth, (c) => {
  return c.render(<pages.NewKeyPage />)
})

app.post('/keys/new', pageAuth, async (c) => {
  const form = await readForm(c)
  const config = formCardConfig(form)
  if (!config) {
    return c.render(<pages.NewKeyPage error="有效天数和最大设备数必须为正整数" />)
  }

  let keys: string[] = []
  if (form.mode === 'single') {
    if (!form.key?.trim()) {
      return c.render(<pages.NewKeyPage error="请填写卡密" />)
    }
    keys = [form.key.trim()]
  } else if (form.mode === 'generate') {
    const count = Math.min(parsePositiveInt(form.count, 0), 1000)
    if (count < 1) return c.render(<pages.NewKeyPage error="生成数量无效" />)
    const rawPrefix = form.prefix?.trim().toUpperCase() || 'CP'
    const prefix = /^[A-Z0-9-]{1,10}$/.test(rawPrefix) ? rawPrefix : 'CP'
    const generated = new Set<string>()
    while (generated.size < count) generated.add(generateKey(prefix))
    keys = [...generated]
  } else if (form.mode === 'bulk') {
    keys = dedupe((form.keys ?? '').split(/[\s,，]+/))
    if (keys.length === 0) return c.render(<pages.NewKeyPage error="请填写卡密列表" />)
    keys = keys.slice(0, 1000)
  } else {
    return c.render(<pages.NewKeyPage error="未知操作" />)
  }

  const existing = await store.existingKeys(c.env.DB, keys)
  const toInsert = keys.filter((k) => !existing.has(k))
  await store.insertCards(
    c.env.DB,
    toInsert.map((key) => ({ key, ...config })),
  )
  return c.render(<pages.CreatedPage created={toInsert.length} skipped={keys.length - toInsert.length} keys={toInsert} />)
})

app.post('/keys/batch-delete', pageAuth, async (c) => {
  const ids = await readFormIds(c)
  if (ids.length === 0) return c.redirect('/keys')
  const cards = await store.getCardsByIds(c.env.DB, ids)
  if (cards.length === 0) return c.redirect('/keys')
  return c.render(<pages.BatchDeleteConfirmPage cards={cards} />)
})

app.post('/keys/batch-delete/confirm', pageAuth, async (c) => {
  const ids = await readFormIds(c)
  const deleted = await store.deleteCards(c.env.DB, ids)
  return c.redirect(`/keys?deleted=${deleted}`)
})

app.get('/keys/:id', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.notFound()
  const [bindings, logs] = await Promise.all([
    store.getBindings(c.env.DB, id),
    store.getRecentLogs(c.env.DB, id, 10),
  ])
  return c.render(<pages.KeyDetailPage card={card} bindings={bindings} logs={logs} />)
})

app.post('/keys/:id/edit', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.notFound()
  const config = formCardConfig(await readForm(c))
  if (!config) return c.redirect(`/keys/${id}`)
  await store.updateCard(c.env.DB, id, config)
  return c.redirect(`/keys/${id}`)
})

app.post('/keys/:id/note', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.notFound()
  const form = await readForm(c)
  await store.updateCard(c.env.DB, id, { note: form.note?.trim() || null })
  const next = safeNext(form.next)
  return c.redirect(next === '/' ? '/keys' : next)
})

app.post('/keys/:id/status', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.notFound()
  const form = await readForm(c)
  const disable = form.disabled === '1'
  const status: CardStatus = disable
    ? 'disabled'
    : card.activated_at == null
      ? 'unused'
      : card.expires_at && Date.now() > card.expires_at
        ? 'expired'
        : 'active'
  await store.updateCard(c.env.DB, id, { status })
  return c.redirect(`/keys/${id}`)
})

app.get('/keys/:id/delete', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const card = await store.getCardById(c.env.DB, id)
  if (!card) return c.notFound()
  return c.render(<pages.DeleteConfirmPage card={card} />)
})

app.post('/keys/:id/delete', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  await store.deleteCard(c.env.DB, id)
  return c.redirect('/keys')
})

app.post('/keys/:id/devices/:device/unbind', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  let device = c.req.param('device')
  try {
    device = decodeURIComponent(device)
  } catch {
    // 原样使用
  }
  await store.deleteBinding(c.env.DB, id, device)
  return c.redirect(`/keys/${id}`)
})

// ---------------------------------------------------------------------------
// 公告页面
// ---------------------------------------------------------------------------
// 公开页
app.get('/announcements', async (c) => {
  return c.render(<pages.PublicAnnouncementsPage items={await store.listPublicAnnouncements(c.env.DB)} />)
})

// 管理页（与公开页路径分离，避免路由冲突）
app.get('/admin/announcements', pageAuth, async (c) => {
  return c.render(<pages.AnnouncementsPage items={await store.listAllAnnouncements(c.env.DB)} />)
})

app.get('/admin/announcements/new', pageAuth, (c) => {
  return c.render(<pages.AnnouncementFormPage />)
})

app.post('/admin/announcements/new', pageAuth, async (c) => {
  const input = parseAnnouncementForm(await readForm(c))
  if (!input) {
    return c.render(<pages.AnnouncementFormPage error="请检查标题、内容、下载链接格式及生效/失效时间" />)
  }
  await store.insertAnnouncement(c.env.DB, input)
  return c.redirect('/admin/announcements')
})

app.get('/admin/announcements/:id/edit', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const announcement = await store.getAnnouncementById(c.env.DB, id)
  if (!announcement) return c.notFound()
  return c.render(<pages.AnnouncementFormPage announcement={announcement} />)
})

app.post('/admin/announcements/:id/edit', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const announcement = await store.getAnnouncementById(c.env.DB, id)
  if (!announcement) return c.notFound()
  const input = parseAnnouncementForm(await readForm(c))
  if (!input) {
    return c.render(<pages.AnnouncementFormPage announcement={announcement} error="请检查标题、内容、下载链接格式及生效/失效时间" />)
  }
  await store.updateAnnouncement(c.env.DB, id, input)
  return c.redirect('/admin/announcements')
})

app.get('/admin/announcements/:id/delete', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const announcement = await store.getAnnouncementById(c.env.DB, id)
  if (!announcement) return c.notFound()
  return c.render(<pages.AnnouncementDeleteConfirmPage announcement={announcement} />)
})

app.post('/admin/announcements/:id/delete', pageAuth, async (c) => {
  await store.deleteAnnouncement(c.env.DB, Number(c.req.param('id')))
  return c.redirect('/admin/announcements')
})

// ---------------------------------------------------------------------------
// 站点配置页面
// ---------------------------------------------------------------------------
app.get('/admin/site-configs', pageAuth, async (c) => {
  return c.render(<pages.SiteConfigsPage items={await store.listAllSiteConfigs(c.env.DB)} />)
})

app.get('/admin/site-configs/new', pageAuth, (c) => {
  return c.render(<pages.SiteConfigFormPage />)
})

app.post('/admin/site-configs/new', pageAuth, async (c) => {
  const input = parseSiteConfigForm(await readForm(c))
  if (!input) {
    return c.render(<pages.SiteConfigFormPage error="请检查标题、版本号、文件地址与描述" />)
  }
  await store.insertSiteConfig(c.env.DB, input)
  return c.redirect('/admin/site-configs')
})

// 表单中的文件上传走 Cookie 鉴权，上传成功后返回可填回表单的 R2 文件地址
app.post('/admin/site-configs/upload', pageAuth, async (c) => {
  const { file, error } = readUploadedFile(await c.req.formData())
  if (error || !file) return c.json({ error: 'BAD_REQUEST', message: error ?? '缺少文件' }, 400)
  return c.json({ url: await uploadR2File(c, file) })
})

app.get('/admin/site-configs/:id/edit', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const config = await store.getSiteConfigById(c.env.DB, id)
  if (!config) return c.notFound()
  return c.render(<pages.SiteConfigFormPage config={config} />)
})

app.post('/admin/site-configs/:id/edit', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const config = await store.getSiteConfigById(c.env.DB, id)
  if (!config) return c.notFound()
  const input = parseSiteConfigForm(await readForm(c))
  if (!input) {
    return c.render(<pages.SiteConfigFormPage config={config} error="请检查标题、版本号、文件地址与描述" />)
  }
  await store.updateSiteConfig(c.env.DB, id, input)
  return c.redirect('/admin/site-configs')
})

app.get('/admin/site-configs/:id/delete', pageAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const config = await store.getSiteConfigById(c.env.DB, id)
  if (!config) return c.notFound()
  return c.render(<pages.SiteConfigDeleteConfirmPage config={config} />)
})

app.post('/admin/site-configs/:id/delete', pageAuth, async (c) => {
  await store.deleteSiteConfig(c.env.DB, Number(c.req.param('id')))
  return c.redirect('/admin/site-configs')
})

app.get('/docs', pageAuth, (c) => {
  return c.render(<pages.DocsPage />)
})

export default app
