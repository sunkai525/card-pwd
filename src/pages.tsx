import type { Child } from 'hono/jsx'
import type { Announcement, CardKey, CardStatus, DeviceBinding, Stats, VerifyLog } from './types'
import {
  ANNOUNCEMENT_TYPES,
  announcementTypeLabel,
  displayStatus,
  formatTime,
  isActiveAnnouncement,
  remainingDays,
} from './utils'

function AdminShell({ title, children }: { title: string; children?: Child }) {
  return (
    <div class="app">
      <header class="topbar">
        <a class="brand" href="/">
          卡密管理系统
        </a>
        <nav>
          <a href="/">概览</a>
          <a href="/keys">卡密列表</a>
          <a href="/keys/new">新增/导入</a>
          <a href="/admin/announcements">公告管理</a>
          <a href="/docs">API 文档</a>
          <form method="post" action="/logout" class="inline">
            <button type="submit" class="link-button">
              退出
            </button>
          </form>
        </nav>
      </header>
      <main class="main">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}

const STATUS_OPTIONS: { value: CardStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'unused', label: '未激活' },
  { value: 'active', label: '使用中' },
  { value: 'expired', label: '已过期' },
  { value: 'disabled', label: '已禁用' },
]

export function LoginPage({ error, next }: { error?: string; next: string }) {
  return (
    <div class="login-wrap">
      <form method="post" action="/login" class="panel login-card">
        <h1>卡密管理系统</h1>
        <p class="muted">请输入管理 Token 后继续</p>
        {error && <p class="error">{error}</p>}
        <input type="hidden" name="next" value={next} />
        <label>
          管理 Token
          <input type="password" name="token" placeholder="ADMIN_TOKEN" required autofocus />
        </label>
        <button type="submit">登录</button>
      </form>
    </div>
  )
}

export function DashboardPage({
  stats,
  recentVerifies,
  recentCards,
  announcements,
}: {
  stats: Stats
  recentVerifies: VerifyLog[]
  recentCards: CardKey[]
  announcements: Announcement[]
}) {
  const statItems = [
    { label: '卡密总数', value: stats.total, cls: '' },
    { label: '未激活', value: stats.unused, cls: 's-unused' },
    { label: '使用中', value: stats.active, cls: 's-active' },
    { label: '已过期', value: stats.expired, cls: 's-expired' },
    { label: '已禁用', value: stats.disabled, cls: 's-disabled' },
    { label: '已绑定设备', value: stats.bindings, cls: '' },
  ]
  return (
    <AdminShell title="概览">
      <section class="grid stats">
        {statItems.map((item) => (
          <div class={`panel stat ${item.cls}`}>
            <div class="stat-value">{item.value}</div>
            <div class="stat-label">{item.label}</div>
          </div>
        ))}
      </section>
      <p class="muted">近 24 小时校验次数：{stats.verifies_today}</p>
      <section class="grid two">
        <div class="panel">
          <h2>最近卡密</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>卡密</th>
                <th>状态</th>
                <th>剩余</th>
              </tr>
            </thead>
            <tbody>
              {recentCards.map((card) => (
                <tr>
                  <td>
                    <a href={`/keys/${card.id}`}>#{card.id}</a>
                  </td>
                  <td class="mono">{card.key}</td>
                  <td>
                    <span class={`badge b-${card.status}`}>{displayStatus(card.status)}</span>
                  </td>
                  <td>{card.activated_at ? `${remainingDays(card.expires_at)} 天` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>最近校验</h2>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>卡密</th>
                <th>设备</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {recentVerifies.map((log) => (
                <tr>
                  <td class="mono sm">{formatTime(log.created_at)}</td>
                  <td class="mono">{log.key}</td>
                  <td class="mono sm">{log.device_id}</td>
                  <td>
                    <span class={`badge ${log.result === 'ok' ? 'b-active' : 'b-expired'}`}>{log.result}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {announcements.length > 0 && (
        <section class="panel">
          <h2>当前公告</h2>
          <ul class="notice-list">
            {announcements.map((a) => (
              <li>
                {a.pinned === 1 && <span class="badge b-unused">置顶</span>}
                <span class={`badge t-${a.type}`}>{announcementTypeLabel(a.type)}</span>
                <a href={`/announcements#a-${a.id}`}>{a.title}</a>
                <span class="muted sm">{formatTime(a.starts_at ?? a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminShell>
  )
}

export function KeysPage({
  items,
  total,
  page,
  pageSize,
  status,
  q,
  message,
}: {
  items: CardKey[]
  total: number
  page: number
  pageSize: number
  status: CardStatus | ''
  q: string
  message?: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const link = (p: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    params.set('page', String(p))
    return `/keys?${params.toString()}`
  }
  return (
    <AdminShell title="卡密列表">
      <div class="toolbar">
        <form method="get" action="/keys" class="filters">
          <input name="q" value={q} placeholder="搜索卡密或备注" />
          <select name="status">
            {STATUS_OPTIONS.map((opt) => (
              <option value={opt.value} selected={status === opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button type="submit">筛选</button>
        </form>
        <a class="button primary" href="/keys/new">
          新增 / 导入
        </a>
      </div>
      {message && <p class="ok">{message}</p>}
      <p class="muted">共 {total} 条</p>
      <form method="post" action="/keys/batch-delete">
        <div class="batch-bar">
          <button type="submit" class="danger">
            批量删除选中项
          </button>
          <span class="muted">勾选需要删除的卡密</span>
        </div>
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th title="全选本页">
                  <input type="checkbox" id="select-all" />
                </th>
                <th>ID</th>
                <th>卡密</th>
                <th>状态</th>
                <th>有效期</th>
                <th>设备</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((card) => (
                <tr>
                  <td>
                    <input type="checkbox" class="row-check" name="ids" value={card.id} />
                  </td>
                  <td>#{card.id}</td>
                  <td class="mono">{card.key}</td>
                  <td>
                    <span class={`badge b-${card.status}`}>{displayStatus(card.status)}</span>
                  </td>
                  <td>{card.activated_at ? `${remainingDays(card.expires_at)} 天` : `${card.valid_days} 天(未激活)`}</td>
                  <td>{card.activated_at ? '已绑定' : '—'}</td>
                  <td>{card.note ?? ''}</td>
                  <td>
                    <a href={`/keys/${card.id}`}>详情</a>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colspan={8} class="muted center">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
      <div class="pagination">
        {page > 1 && <a href={link(page - 1)}>上一页</a>}
        <span>
          第 {page} / {totalPages} 页
        </span>
        {page < totalPages && <a href={link(page + 1)}>下一页</a>}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            const all = document.getElementById('select-all');
            const rows = Array.from(document.querySelectorAll('input.row-check'));
            all.addEventListener('change', () => rows.forEach((r) => { r.checked = all.checked; }));
            rows.forEach((r) => r.addEventListener('change', () => {
              all.checked = rows.length > 0 && rows.every((x) => x.checked);
            }));
          `,
        }}
      ></script>
    </AdminShell>
  )
}

function CommonFields({ validDays, maxDevices }: { validDays: number; maxDevices: number }) {
  return (
    <>
      <label>
        有效天数（首次校验后开始计算）
        <input type="number" name="valid_days" value={validDays} min="1" required />
      </label>
      <label>
        最大绑定设备数
        <input type="number" name="max_devices" value={maxDevices} min="1" required />
      </label>
      <label>
        备注
        <input name="note" placeholder="可选" />
      </label>
    </>
  )
}

export function NewKeyPage({ error }: { error?: string }) {
  return (
    <AdminShell title="新增 / 导入卡密">
      {error && <p class="error">{error}</p>}
      <div class="grid two">
        <form method="post" action="/keys/new" class="panel">
          <input type="hidden" name="mode" value="single" />
          <h2>单个新增</h2>
          <label>
            卡密
            <input name="key" placeholder="自定义卡密值" required />
          </label>
          <CommonFields validDays={30} maxDevices={1} />
          <button type="submit">创建</button>
        </form>
        <form method="post" action="/keys/new" class="panel">
          <input type="hidden" name="mode" value="generate" />
          <h2>批量生成</h2>
          <label>
            生成数量
            <input type="number" name="count" value="10" min="1" max="1000" required />
          </label>
          <label>
            前缀
            <input name="prefix" value="CP" />
          </label>
          <CommonFields validDays={30} maxDevices={1} />
          <button type="submit">生成</button>
        </form>
      </div>
      <form method="post" action="/keys/new" class="panel">
        <input type="hidden" name="mode" value="bulk" />
        <h2>批量导入已有卡密</h2>
        <label>
          卡密列表（每行一个，或用逗号分隔）
          <textarea name="keys" rows={6} placeholder="KEY-001&#10;KEY-002&#10;KEY-003" required></textarea>
        </label>
        <CommonFields validDays={30} maxDevices={1} />
        <button type="submit">导入</button>
      </form>
    </AdminShell>
  )
}

export function CreatedPage({ created, skipped, keys }: { created: number; skipped: number; keys: string[] }) {
  return (
    <AdminShell title="创建完成">
      <p>
        成功创建 <strong>{created}</strong> 条，跳过重复 <strong>{skipped}</strong> 条。
      </p>
      {keys.length > 0 && (
        <div class="panel">
          <h2>卡密列表（请妥善保存）</h2>
          <textarea rows={12} readonly>
            {keys.join('\n')}
          </textarea>
        </div>
      )}
      <p>
        <a class="button" href="/keys/new">
          继续新增
        </a>
        <a class="button primary" href="/keys">
          返回列表
        </a>
      </p>
    </AdminShell>
  )
}

export function KeyDetailPage({
  card,
  bindings,
  logs,
  message,
}: {
  card: CardKey
  bindings: DeviceBinding[]
  logs: VerifyLog[]
  message?: string
}) {
  return (
    <AdminShell title={`卡密详情 #${card.id}`}>
      {message && <p class="ok">{message}</p>}
      <div class="grid two">
        <section class="panel">
          <h2>基本信息</h2>
          <dl class="detail">
            <dt>卡密</dt>
            <dd class="mono">{card.key}</dd>
            <dt>状态</dt>
            <dd>
              <span class={`badge b-${card.status}`}>{displayStatus(card.status)}</span>
            </dd>
            <dt>有效天数</dt>
            <dd>{card.valid_days} 天</dd>
            <dt>最大设备数</dt>
            <dd>{card.max_devices}</dd>
            <dt>激活时间</dt>
            <dd>{formatTime(card.activated_at)}</dd>
            <dt>到期时间</dt>
            <dd>{formatTime(card.expires_at)}</dd>
            <dt>剩余天数</dt>
            <dd>{card.activated_at ? `${remainingDays(card.expires_at)} 天` : '—'}</dd>
            <dt>备注</dt>
            <dd>{card.note ?? '—'}</dd>
          </dl>
          <div class="actions">
            <form method="post" action={`/keys/${card.id}/status`} class="inline">
              <input type="hidden" name="disabled" value={card.status === 'disabled' ? '0' : '1'} />
              <button type="submit">{card.status === 'disabled' ? '启用' : '禁用'}</button>
            </form>
            <a class="button danger" href={`/keys/${card.id}/delete`}>
              删除
            </a>
          </div>
        </section>
        <section class="panel">
          <h2>编辑配置</h2>
          <form method="post" action={`/keys/${card.id}/edit`}>
            <label>
              有效天数
              <input type="number" name="valid_days" value={card.valid_days} min="1" required />
            </label>
            <label>
              最大设备数
              <input type="number" name="max_devices" value={card.max_devices} min="1" required />
            </label>
            <label>
              备注
              <input name="note" value={card.note ?? ''} />
            </label>
            <button type="submit">保存</button>
          </form>
        </section>
      </div>
      <section class="panel">
        <h2>绑定设备（{bindings.length} / {card.max_devices}）</h2>
        <table>
          <thead>
            <tr>
              <th>设备 ID</th>
              <th>绑定时间</th>
              <th>最近活跃</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr>
                <td class="mono">{b.device_id}</td>
                <td class="mono sm">{formatTime(b.bound_at)}</td>
                <td class="mono sm">{formatTime(b.last_seen_at)}</td>
                <td>
                  <form method="post" action={`/keys/${card.id}/devices/${encodeURIComponent(b.device_id)}/unbind`} class="inline">
                    <button type="submit" class="link-button danger-text">
                      解绑
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {bindings.length === 0 && (
              <tr>
                <td colspan={4} class="muted center">
                  暂无绑定设备
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section class="panel">
        <h2>最近校验日志</h2>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>设备 ID</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr>
                <td class="mono sm">{formatTime(log.created_at)}</td>
                <td class="mono sm">{log.device_id}</td>
                <td>
                  <span class={`badge ${log.result === 'ok' ? 'b-active' : 'b-expired'}`}>{log.result}</span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colspan={3} class="muted center">
                  暂无日志
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  )
}

export function DeleteConfirmPage({ card }: { card: CardKey }) {
  return (
    <AdminShell title="确认删除">
      <div class="panel">
        <p>
          确定删除卡密 <span class="mono">{card.key}</span> 吗？此操作不可恢复，将一并删除其设备绑定和校验日志。
        </p>
        <form method="post" action={`/keys/${card.id}/delete`} class="inline">
          <button type="submit" class="danger">
            确认删除
          </button>
        </form>
        <a class="button" href={`/keys/${card.id}`}>
          取消
        </a>
      </div>
    </AdminShell>
  )
}

export function BatchDeleteConfirmPage({ cards }: { cards: CardKey[] }) {
  return (
    <AdminShell title="确认批量删除">
      <div class="panel">
        <p>
          确定删除以下 <strong>{cards.length}</strong> 张卡密吗？此操作不可恢复，将一并删除其设备绑定和校验日志。
        </p>
        <ul class="key-list">
          {cards.map((card) => (
            <li>
              <span class="mono">{card.key}</span>
              <span class="muted">（#{card.id}，{displayStatus(card.status)}）</span>
            </li>
          ))}
        </ul>
        <form method="post" action="/keys/batch-delete/confirm">
          {cards.map((card) => (
            <input type="hidden" name="ids" value={card.id} />
          ))}
          <button type="submit" class="danger">
            确认删除 {cards.length} 张
          </button>
          <a class="button" href="/keys">
            取消
          </a>
        </form>
      </div>
    </AdminShell>
  )
}

function noticeState(a: Announcement): { label: string; cls: string } {
  const t = Date.now()
  if (a.starts_at != null && a.starts_at > t) return { label: '未生效', cls: 'b-unused' }
  if (a.ends_at != null && a.ends_at < t) return { label: '已失效', cls: 'b-disabled' }
  return { label: '生效中', cls: 'b-active' }
}

export function AnnouncementsPage({ items }: { items: Announcement[] }) {
  return (
    <AdminShell title="公告管理">
      <div class="toolbar">
        <p class="muted">共 {items.length} 条公告，公开页面：/announcements</p>
        <a class="button primary" href="/admin/announcements/new">
          发布公告
        </a>
      </div>
      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>标题</th>
              <th>类型</th>
              <th>下载链接</th>
              <th>状态</th>
              <th>置顶</th>
              <th>生效时间 (UTC)</th>
              <th>失效时间 (UTC)</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const state = noticeState(a)
              return (
                <tr>
                  <td>#{a.id}</td>
                  <td>{a.title}</td>
                  <td>
                    <span class={`badge t-${a.type}`}>{announcementTypeLabel(a.type)}</span>
                  </td>
                  <td>
                    {a.download_url ? (
                      <a href={a.download_url} target="_blank" rel="noopener noreferrer" class="sm">
                        下载
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span class={`badge ${state.cls}`}>{state.label}</span>
                  </td>
                  <td>{a.pinned === 1 ? '是' : '—'}</td>
                  <td class="mono sm">{formatTime(a.starts_at)}</td>
                  <td class="mono sm">{formatTime(a.ends_at)}</td>
                  <td>
                    <a href={`/admin/announcements/${a.id}/edit`}>编辑</a>
                    {' · '}
                    <a href={`/admin/announcements/${a.id}/delete`}>删除</a>
                  </td>
                </tr>
              )
            })}
            {items.length === 0 && (
              <tr>
                <td colspan={9} class="muted center">
                  暂无公告
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}

export function AnnouncementFormPage({
  announcement,
  error,
}: {
  announcement?: Announcement
  error?: string
}) {
  const editing = announcement != null
  return (
    <AdminShell title={editing ? `编辑公告 #${announcement!.id}` : '发布公告'}>
      {error && <p class="error">{error}</p>}
      <form method="post" action={editing ? `/admin/announcements/${announcement!.id}/edit` : '/admin/announcements/new'} class="panel">
        <label>
          标题
          <input name="title" value={announcement?.title ?? ''} required maxlength={200} />
        </label>
        <label>
          内容
          <textarea name="content" rows={10} placeholder="公告正文" required>
            {announcement?.content ?? ''}
          </textarea>
        </label>
        <label>
          公告类型
          <select name="type">
            {ANNOUNCEMENT_TYPES.map((t) => (
              <option value={t.value} selected={(announcement?.type ?? 'normal') === t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          下载链接（可选，http/https）
          <input
            type="url"
            name="download_url"
            value={announcement?.download_url ?? ''}
            placeholder="https://example.com/download.exe"
          />
        </label>
        <label>
          生效时间（UTC，留空 = 立即生效）
          <input type="datetime-local" name="starts_at" value={toDatetimeLocal(announcement?.starts_at)} />
        </label>
        <label>
          失效时间（UTC，留空 = 长期有效）
          <input type="datetime-local" name="ends_at" value={toDatetimeLocal(announcement?.ends_at)} />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" name="pinned" value="1" checked={announcement?.pinned === 1} />
          置顶显示
        </label>
        <button type="submit" class="primary">
          {editing ? '保存修改' : '发布公告'}
        </button>
        <a class="button" href="/admin/announcements">
          取消
        </a>
      </form>
    </AdminShell>
  )
}

export function AnnouncementDeleteConfirmPage({ announcement }: { announcement: Announcement }) {
  return (
    <AdminShell title="确认删除公告">
      <div class="panel">
        <p>
          确定删除公告 <strong>{announcement.title}</strong> 吗？此操作不可恢复。
        </p>
        <form method="post" action={`/admin/announcements/${announcement.id}/delete`} class="inline">
          <button type="submit" class="danger">
            确认删除
          </button>
        </form>
        <a class="button" href="/admin/announcements">
          取消
        </a>
      </div>
    </AdminShell>
  )
}

function toDatetimeLocal(ts: number | null | undefined): string {
  if (ts == null) return ''
  return new Date(ts).toISOString().slice(0, 16)
}

export function PublicAnnouncementsPage({ items }: { items: Announcement[] }) {
  return (
    <div class="public-page">
      <header class="public-header">
        <h1>系统公告</h1>
        <a class="button" href="/api/announcements">
          查看 JSON 接口
        </a>
      </header>
      <main class="main">
        {items.length === 0 && <div class="panel muted center">暂无公告</div>}
        {items.map((a) => (
          <article class="panel notice" id={`a-${a.id}`}>
            <h2>
              {a.pinned === 1 && <span class="badge b-unused">置顶</span>}
              <span class={`badge t-${a.type}`}>{announcementTypeLabel(a.type)}</span>
              {a.title}
            </h2>
            <div class="muted sm">{formatTime(a.starts_at ?? a.created_at)}</div>
            <div class="notice-content">{a.content}</div>
            {a.download_url && (
              <p>
                <a class="button primary" href={a.download_url} target="_blank" rel="noopener noreferrer">
                  下载更新
                </a>
              </p>
            )}
          </article>
        ))}
      </main>
    </div>
  )
}

export function DocsPage() {
  return (
    <AdminShell title="API 文档">
      <section class="panel">
        <h2>概览</h2>
        <table>
          <tbody>
            <tr><th>基础地址</th><td class="mono">当前站点根路径，例如 http://localhost:8787</td></tr>
            <tr><th>数据格式</th><td>请求与响应均为 JSON（<code>Content-Type: application/json</code>）</td></tr>
            <tr><th>鉴权</th><td>管理接口需请求头 <code>Authorization: Bearer &lt;管理Token&gt;</code>；对外接口无需鉴权</td></tr>
            <tr><th>时间戳</th><td>响应中的时间均为 Unix 毫秒；公告请求中的时间字段接受 ISO 8601 字符串</td></tr>
            <tr><th>错误约定</th><td>业务失败返回 HTTP 200 + <code>valid:false</code> 或 <code>error</code>；鉴权失败 401，参数错误 400，资源不存在 404</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>对外接口 · 无需鉴权</h2>
        <h3>POST /api/verify — 校验即核销</h3>
        <pre>
{`请求
{
  "key": "CP-XXXX-XXXX-XXXX-XXXX",
  "device_id": "device-001"
}

成功（HTTP 200）
{
  "valid": true,
  "key": "CP-XXXX-XXXX-XXXX-XXXX",
  "expires_at": 1794932803262,
  "remaining_days": 1,
  "bound_devices": 1,
  "max_devices": 1,
  "device_id": "device-001"
}

失败（HTTP 200）
{ "valid": false, "code": "DEVICE_LIMIT", "message": "绑定设备数已达上限" }`}
        </pre>
        <p class="muted">
          首次校验即激活卡密并开始计算有效期；同一 <code>device_id</code> 重复校验只刷新活跃时间；新设备超过{' '}
          <code>max_devices</code> 则拒绝。
        </p>
        <table>
          <thead><tr><th>错误码</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td class="mono">INVALID_KEY</td><td>卡密不存在</td></tr>
            <tr><td class="mono">DISABLED</td><td>卡密已被禁用</td></tr>
            <tr><td class="mono">EXPIRED</td><td>卡密已过期</td></tr>
            <tr><td class="mono">DEVICE_LIMIT</td><td>绑定设备数已达上限</td></tr>
            <tr><td class="mono">BAD_REQUEST</td><td>请求格式错误（HTTP 400）</td></tr>
          </tbody>
        </table>

        <h3>GET /api/announcements — 当前生效公告</h3>
        <pre>
{`{
  "items": [
    {
      "id": 1,
      "title": "客户端 v2.1 发布",
      "content": "请升级到最新版本",
      "type": "client_update",
      "download_url": "https://example.com/app-v2.1.exe",
      "pinned": 1,
      "starts_at": null,
      "ends_at": 1796112000000,
      "created_at": 1794846403225,
      "updated_at": 1794846403225
    }
  ]
}`}
        </pre>
        <p class="muted">
          仅返回生效期内（<code>starts_at</code> 已到且 <code>ends_at</code> 未到）的公告，按「置顶 → 生效/创建时间倒序」排列。
        </p>
      </section>

      <section class="panel">
        <h2>管理接口 · 需 Bearer Token</h2>
        <h3>卡密</h3>
        <table>
          <thead><tr><th>方法</th><th>路径</th><th>请求体 / 参数</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td class="mono">GET</td><td class="mono">/api/admin/stats</td><td>—</td><td>统计概览</td></tr>
            <tr><td class="mono">GET</td><td class="mono">/api/admin/keys</td><td class="mono">page, page_size, status, q</td><td>分页列表</td></tr>
            <tr><td class="mono">POST</td><td class="mono">/api/admin/keys</td><td class="mono">{'{ key, valid_days, max_devices, note? }'}</td><td>单个新增</td></tr>
            <tr><td class="mono">POST</td><td class="mono">/api/admin/keys/import</td><td class="mono">{'{ keys[] 或 count, prefix?, valid_days, max_devices, note? }'}</td><td>批量导入/生成</td></tr>
            <tr><td class="mono">GET</td><td class="mono">/api/admin/keys/:id</td><td>—</td><td>详情（含绑定设备与校验日志）</td></tr>
            <tr><td class="mono">PATCH</td><td class="mono">/api/admin/keys/:id</td><td class="mono">{'{ valid_days?, max_devices?, note?, status?, disabled? }'}</td><td>修改配置/禁用启用</td></tr>
            <tr><td class="mono">DELETE</td><td class="mono">/api/admin/keys</td><td class="mono">{'{ ids: number[] }'}</td><td>批量删除（含级联清理）</td></tr>
            <tr><td class="mono">DELETE</td><td class="mono">/api/admin/keys/:id</td><td>—</td><td>删除单个卡密</td></tr>
            <tr><td class="mono">DELETE</td><td class="mono">/api/admin/keys/:id/devices/:device</td><td>—</td><td>解绑设备</td></tr>
          </tbody>
        </table>
        <h3>公告</h3>
        <table>
          <thead><tr><th>方法</th><th>路径</th><th>请求体</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td class="mono">GET</td><td class="mono">/api/admin/announcements</td><td>—</td><td>全部公告（含未生效/已失效）</td></tr>
            <tr><td class="mono">POST</td><td class="mono">/api/admin/announcements</td><td class="mono">公告字段，见下</td><td>发布公告</td></tr>
            <tr><td class="mono">PATCH</td><td class="mono">/api/admin/announcements/:id</td><td>任意公告字段</td><td>修改公告</td></tr>
            <tr><td class="mono">DELETE</td><td class="mono">/api/admin/announcements/:id</td><td>—</td><td>删除公告</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>请求与响应示例</h2>
        <pre>
{`# 统计
curl http://localhost:8787/api/admin/stats \\
  -H "Authorization: Bearer $TOKEN"
# => { "total": 10, "unused": 3, "active": 6, "expired": 1,
#      "disabled": 0, "bindings": 7, "verifies_today": 42 }

# 批量生成 100 张卡密
curl -X POST http://localhost:8787/api/admin/keys/import \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"count":100,"prefix":"CP","valid_days":30,"max_devices":2}'
# => { "created": 100, "skipped": 0, "keys": ["CP-...", ...] }

# 批量删除
curl -X DELETE http://localhost:8787/api/admin/keys \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"ids":[1,2,3]}'
# => { "deleted": 3 }

# 发布公告（类型 + 下载链接）
curl -X POST http://localhost:8787/api/admin/announcements \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"title":"客户端 v2.1","content":"请升级","type":"client_update",
       "download_url":"https://example.com/app.exe","pinned":true}'`}
        </pre>
      </section>

      <section class="panel">
        <h2>数据结构</h2>
        <h3>CardKey（卡密）</h3>
        <table>
          <thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td class="mono">id</td><td>number</td><td>主键</td></tr>
            <tr><td class="mono">key</td><td>string</td><td>卡密值，唯一</td></tr>
            <tr><td class="mono">valid_days</td><td>number</td><td>有效天数（首次校验后开始计算）</td></tr>
            <tr><td class="mono">max_devices</td><td>number</td><td>最大绑定设备数，满则拒绝新设备</td></tr>
            <tr><td class="mono">status</td><td>string</td><td>unused / active / expired / disabled</td></tr>
            <tr><td class="mono">note</td><td>string | null</td><td>备注</td></tr>
            <tr><td class="mono">activated_at</td><td>number | null</td><td>首次校验时间</td></tr>
            <tr><td class="mono">expires_at</td><td>number | null</td><td>到期时间</td></tr>
          </tbody>
        </table>
        <h3>Announcement（公告）</h3>
        <table>
          <thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td class="mono">id</td><td>number</td><td>主键</td></tr>
            <tr><td class="mono">title</td><td>string</td><td>标题</td></tr>
            <tr><td class="mono">content</td><td>string</td><td>正文（纯文本）</td></tr>
            <tr><td class="mono">type</td><td>string</td><td>normal / client_update / site_config</td></tr>
            <tr><td class="mono">download_url</td><td>string | null</td><td>下载链接（仅 http/https）</td></tr>
            <tr><td class="mono">pinned</td><td>0 | 1</td><td>是否置顶</td></tr>
            <tr><td class="mono">starts_at</td><td>number | null</td><td>生效时间，null 表示立即</td></tr>
            <tr><td class="mono">ends_at</td><td>number | null</td><td>失效时间，null 表示长期有效</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>通用错误</h2>
        <table>
          <thead><tr><th>状态</th><th>响应</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>401</td><td class="mono">{'{ error: "UNAUTHORIZED", message: "需要有效的管理 Token" }'}</td><td>缺少或错误的 Bearer Token</td></tr>
            <tr><td>400</td><td class="mono">{'{ error: "BAD_REQUEST", message: "..." }'}</td><td>参数缺失或格式错误</td></tr>
            <tr><td>404</td><td class="mono">{'{ error: "NOT_FOUND" }'}</td><td>资源不存在</td></tr>
            <tr><td>409</td><td class="mono">{'{ error: "DUPLICATE_KEY" }'}</td><td>新增卡密时 key 已存在</td></tr>
          </tbody>
        </table>
      </section>
    </AdminShell>
  )
}
