# card-pwd — agent notes

Cloudflare Worker (Hono) 卡密/公告管理系统。Worker 入口 `src/index.tsx`；DB 全在 `src/store.ts`；校验逻辑 `src/verify.ts`；SSR 页面 `src/pages.tsx`；HTML 模板 `src/renderer.tsx`。

## Setup（顺序重要）

1. `cp .dev.vars.example .dev.vars` 并设置 `ADMIN_TOKEN`。**.dev.vars 里是用户自己的密钥，不要覆盖或写死 token**。
2. `npx wrangler d1 migrations apply card-pwd-db --local`（新克隆/新增迁移后必做，否则表名不存在）。
3. `npm run dev`（默认 5173；测试时用 `-- --port 8787`）。

## 本地/配置陷阱

- `compatibility_date` 固定为 `2026-11-10`：**不要改成今天**。本地 Miniflare 会拒绝未来日期并导致 dev server 直接退出。
- `wrangler.jsonc` 的 `database_id` 是全 0 占位值，仅供本地。真实部署需 `npx wrangler d1 create card-pwd-db` 后替换，并执行 `npx wrangler d1 migrations apply card-pwd-db --remote`。
- `migrations_dir` 必须写在 `d1_databases[]` 条目内部；放顶层会被 wrangler 报错拒绝。
- 改了 `wrangler.jsonc` 后跑 `npm run cf-typegen`，重新生成 `worker-configuration.d.ts`（提供全局 `CloudflareBindings`）；`src/types.ts` 在其上扩展 `ADMIN_TOKEN`。
- 构建产出 `dist/card_pwd/.dev.vars` 是 Cloudflare 插件为 `vite preview` 生成的，已被 `.assetsignore` 排除，不是泄露，不要"修复"。

## 验证

- 没有 test / lint 脚本。类型检查用 `npx -y -p typescript tsc --noEmit`（typescript 未安装，`npx tsc` 会装错包）；`npm run build` 走 esbuild，**不做类型检查**。
- 改完代码至少跑 `tsc --noEmit` + `npm run build`。端到端只能手动 curl：管理 API 用 `Authorization: Bearer $ADMIN_TOKEN`，页面需先 `POST /login`（表单字段 `token`）拿 HttpOnly Cookie。
- 测试脚本里 curl 参数要显式写出；本环境 shell 是 zsh，未加引号的变量**不会分词**，`C="-b file"` 再 `$C` 会导致 cookie 没传上而误判 401/302。
- 关闭 dev server 用 `kill $(pgrep -f '[v]ite --port 8787')`，不要 `pkill -f "vite --port 8787"`（会匹配到命令自身把 shell 杀掉）。

## 代码约定 / 易踩的坑

- **公开页与后台页路径必须分离**：`/announcements` 是公开页，`/admin/announcements` 起是管理页（列表/发布/编辑/删除）。曾经因两者共用路径导致后台 CRUD 入口无法访问。
- Hono `parseBody()` 默认只保留同名字段的最后一个值。多选批量删除依赖 `readFormIds()` 的 `parseBody({ all: true })`，不要改回默认值。
- Hono JSX：`rows`/`colspan` 等必须是数字（`rows={6}`）；内联 `<script>` 要用 `dangerouslySetInnerHTML`，否则 `>`、`&` 会被 HTML 转义破坏 JS。
- `src/verify.ts` 中设备绑定用单条原子 SQL（`INSERT ... SELECT ... WHERE ... ON CONFLICT`，封装在 `store.bindDevice`）保证并发下不突破 `max_devices`；不要退回到"先查数量再插入"。
- 公告时间：DB 存 Unix 毫秒，API 收 ISO 8601；表单 `datetime-local` 按 UTC 解读并在标签中标注。`type` 仅 `normal` / `client_update` / `site_config`，`download_url` 仅 http/https。
- 接口或字段变动时同步更新 `README.md` 的 API 章节和应用内 `/docs` 页面（`src/pages.tsx` 的 `DocsPage`）。

## 部署

`npm run deploy` = build + wrangler deploy。前置：替换 database_id、`--remote` 应用迁移、`npx wrangler secret put ADMIN_TOKEN`。
