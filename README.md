# card-pwd 卡密管理系统

基于 **Cloudflare Workers + Hono + D1(SQLite) + Vite SSR** 的卡密（授权码）管理系统。

- 卡密属性：有效天数、最大绑定设备数
- 对外校验接口：`POST /api/verify`，**校验即核销**（首次校验激活并开始计算有效期）
- 管理端：API Token 鉴权的 REST API + SSR 管理页面（列表、新增/批量生成/导入、编辑、禁用、解绑、删除、统计）
- 公告：对外公开 API 与展示页，管理端支持置顶、定时生效与失效

## 本地开发

```bash
npm install

# 1. 配置管理 Token（本地开发用）
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，设置一个随机长字符串作为 ADMIN_TOKEN

# 2. 初始化本地 D1 数据库（首次，或迁移文件变更后）
npx wrangler d1 migrations apply card-pwd-db --local

# 3. 启动
npm run dev
```

打开 http://localhost:8787 ，在登录页输入 `.dev.vars` 中的 `ADMIN_TOKEN`。

> `wrangler.jsonc` 中的 `database_id` 当前为占位值，仅本地开发使用；部署前需替换为你自己的 D1 数据库 ID。`compatibility_date` 固定为本地运行时支持的 `2026-11-10`。

## 部署到 Cloudflare

```bash
# 1. 登录并创建 D1 数据库
npx wrangler login
npx wrangler d1 create card-pwd-db
# 将输出的 database_id 填入 wrangler.jsonc

# 2. 执行远程迁移
npx wrangler d1 migrations apply card-pwd-db --remote

# 3. 设置管理 Token（Secret）
npx wrangler secret put ADMIN_TOKEN

# 4. 部署
npm run deploy
```

修改 D1 配置后重新生成类型：

```bash
npm run cf-typegen
```

## 数据模型

| 表 | 说明 |
| --- | --- |
| `card_keys` | 卡密主表：`key`（唯一）、`valid_days`、`max_devices`、`status`、`activated_at`、`expires_at`、`note` |
| `device_bindings` | 设备绑定：`(card_id, device_id)` 唯一，记录绑定与最近活跃时间 |
| `verify_logs` | 校验日志：记录每次校验的卡密、设备与结果 |
| `announcements` | 公告：`title`、`content`、`type`（公告类型）、`download_url`、`pinned`、`starts_at`、`ends_at` |

状态流转：`unused`（未激活）→ `active`（使用中）→ `expired`（已过期）；`disabled`（禁用）可随时切换。

## API

请求与响应均为 JSON。响应中的时间均为 **Unix 毫秒**；公告请求中的时间字段接受 ISO 8601 字符串。管理接口需请求头 `Authorization: Bearer <ADMIN_TOKEN>`，对外接口无需鉴权。应用内的 `/docs` 页面提供同样的速查文档。

### 对外接口（无需鉴权）

#### POST /api/verify — 校验即核销

请求：

```json
{ "key": "CP-XXXX-XXXX-XXXX-XXXX", "device_id": "device-001" }
```

处理规则：

1. 卡密不存在 → `INVALID_KEY`
2. 已禁用 / 已过期 → `DISABLED` / `EXPIRED`
3. 首次校验：激活卡密，`expires_at = 校验时刻 + valid_days`
4. 同一 `device_id` 再次校验：仅刷新活跃时间，返回正常
5. 新设备：若已绑定数 < `max_devices` 则绑定成功；**达到上限直接拒绝** `DEVICE_LIMIT`（绑定检查与写入为原子操作，并发下也不会超限）

响应：

```json
{ "valid": true, "key": "CP-...", "expires_at": 1794932803262, "remaining_days": 1, "bound_devices": 1, "max_devices": 1, "device_id": "device-001" }
{ "valid": false, "code": "DEVICE_LIMIT", "message": "绑定设备数已达上限" }
```

业务失败统一返回 HTTP 200 + `valid: false`；请求格式错误返回 HTTP 400（`BAD_REQUEST`）。

#### GET /api/announcements — 当前生效公告

只返回生效期内（`starts_at` 已到且 `ends_at` 未到）的公告，按「置顶 → 生效/创建时间倒序」排列。`starts_at` 为 `null` 表示立即生效，`ends_at` 为 `null` 表示长期有效。

支持 `type` 查询参数按类型过滤，可选值 `normal` / `client_update` / `site_config`；省略或值非法时返回全部类型。例如 `GET /api/announcements?type=client_update` 只返回客户端版本更新公告。

```json
{ "items": [
  { "id": 1, "title": "客户端 v2.1 发布", "content": "请升级到最新版本",
    "type": "client_update", "download_url": "https://example.com/app.exe",
    "pinned": 1, "starts_at": null, "ends_at": 1796112000000,
    "created_at": 1794846403225, "updated_at": 1794846403225 }
] }
```

### 管理接口（需 Bearer Token）

| 方法 | 路径 | 请求体 / 参数 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/admin/stats` | — | `{ total, unused, active, expired, disabled, bindings, verifies_today }` |
| GET | `/api/admin/keys` | `page`, `page_size`(≤100), `status`, `q` | `{ items, total, page, page_size }` |
| POST | `/api/admin/keys` | `{ key, valid_days, max_devices, note? }` | 201 `{ created: 1, card }`；重复 key 返回 409 `DUPLICATE_KEY` |
| POST | `/api/admin/keys/import` | `{ keys[] 或 count, prefix?, valid_days, max_devices, note? }` | 201 `{ created, skipped, keys }`，`count`/`keys` 单次上限 1000 |
| GET | `/api/admin/keys/:id` | — | `{ card, bindings, logs }` |
| PATCH | `/api/admin/keys/:id` | `{ valid_days?, max_devices?, note?, status?, disabled? }` | `{ card }`；`status` 可选 unused/active/disabled |
| DELETE | `/api/admin/keys` | `{ ids: number[] }` | `{ deleted: 数量 }`，级联清理绑定与日志 |
| DELETE | `/api/admin/keys/:id` | — | `{ deleted: id }` |
| DELETE | `/api/admin/keys/:id/devices/:device` | — | `{ removed: boolean }` |
| GET | `/api/admin/announcements` | — | `{ items }`，含未生效/已失效的全部公告 |
| POST | `/api/admin/announcements` | 公告字段（见下） | 201 `{ announcement }` |
| PATCH | `/api/admin/announcements/:id` | 任意公告字段 | `{ announcement }` |
| DELETE | `/api/admin/announcements/:id` | — | `{ deleted: id }` |

公告字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 必填，≤200 字符 |
| `content` | string | 必填，纯文本 |
| `type` | string | `normal` 普通公告 / `client_update` 客户端版本更新公告 / `site_config` 站点配置更新公告，默认 `normal` |
| `download_url` | string \| null | 下载链接，仅接受 http/https，可为空 |
| `pinned` | boolean \| 0 \| 1 | 是否置顶 |
| `starts_at` | string \| null | 生效时间（ISO 8601），null = 立即 |
| `ends_at` | string \| null | 失效时间（ISO 8601），null = 长期有效；须晚于 `starts_at` |

`CardKey` 字段：`id`、`key`、`valid_days`、`max_devices`、`status`、`note`、`activated_at`、`expires_at`、`created_at`、`updated_at`。

### 错误响应

| 状态码 | 响应 | 说明 |
| --- | --- | --- |
| 401 | `{ error: "UNAUTHORIZED", message: "需要有效的管理 Token" }` | Token 缺失或错误 |
| 400 | `{ error: "BAD_REQUEST", message: "..." }` | 参数缺失或格式错误 |
| 404 | `{ error: "NOT_FOUND" }` | 资源不存在 |
| 409 | `{ error: "DUPLICATE_KEY" }` | 卡密 key 重复 |

### 调用示例

```bash
TOKEN="你的管理Token"

# 校验卡密
curl -X POST http://localhost:8787/api/verify \
  -H 'Content-Type: application/json' \
  -d '{"key":"CP-XXXX-XXXX-XXXX-XXXX","device_id":"device-001"}'

# 批量生成 100 张卡密
curl -X POST http://localhost:8787/api/admin/keys/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"count":100,"prefix":"CP","valid_days":30,"max_devices":2}'

# 批量删除
curl -X DELETE http://localhost:8787/api/admin/keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"ids":[1,2,3]}'

# 发布公告
curl -X POST http://localhost:8787/api/admin/announcements \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"客户端 v2.1","content":"请升级","type":"client_update","download_url":"https://example.com/app.exe","pinned":true}'

# 按类型拉取当前生效公告（无需鉴权）
curl "http://localhost:8787/api/announcements?type=client_update"
```

## 管理页面

| 路径 | 说明 |
| --- | --- |
| `/login` | 输入管理 Token 登录（写入 HttpOnly Cookie，7 天有效） |
| `/` | 概览：统计、最近卡密、最近校验 |
| `/keys` | 卡密列表（分页、状态筛选、搜索、勾选批量删除） |
| `/keys/new` | 单个新增 / 批量生成 / 批量导入 |
| `/keys/:id` | 详情：编辑配置、禁用/启用、解绑设备、删除、校验日志 |
| `/docs` | API 文档速查 |
| `/announcements` | 公开公告页（无需登录） |
| `/admin/announcements` | 公告管理（列表，后台导航「公告管理」入口） |
| `/admin/announcements/new` | 发布公告 |
| `/admin/announcements/:id/edit` | 编辑公告 |
| `/admin/announcements/:id/delete` | 删除确认（二次确认后执行） |

## 公告展示

`/announcements` 是无需登录的公开公告页，客户端也可直接调用 `GET /api/announcements` 拉取。Web 管理后台通过「公告管理」完成增删改查，表单中的日期时间按 UTC 解读。
