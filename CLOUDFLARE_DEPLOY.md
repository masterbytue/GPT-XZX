# Cloudflare 全量部署说明

这套迁移方案把前端放到 Cloudflare Pages，把后端 API 放到 Cloudflare Workers，把原来的本地 SQLite 换成 Cloudflare D1。

## 当前线上地址

- 前端 Pages: https://liwen-zhilian.pages.dev
- Worker API: https://liwen-zhilian-api.946883902.workers.dev
- D1 数据库: `liwen_zhilian`

## 1. 创建 D1 数据库

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create liwen_zhilian
```

把命令输出里的 `database_id` 填到 `worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "liwen_zhilian"
database_id = "你的 database_id"
```

## 2. 设置 Worker 密钥

```bash
cd worker
npx wrangler secret put JWT_SECRET
npx wrangler secret put RELAY_API_KEY
```

`JWT_SECRET` 用一串足够长的随机字符串。`RELAY_API_KEY` 用你现在后端 `.env` 里的模型中转 API Key。

当前模型中转地址为 `https://aizhuan.fun/v1`，密钥仅保存在 Cloudflare Secret 中，不写入仓库。

## 3. 初始化 D1 表结构

```bash
cd worker
npm run db:migrate
```

本地调试 D1 时可以用：

```bash
npm run db:migrate:local
npm run dev
```

## 4. 部署 Worker API

```bash
cd worker
npm run deploy
```

部署后会得到类似：

```text
https://liwen-zhilian-api.YOUR_SUBDOMAIN.workers.dev
```

## 5. 配置前端同源 API

复制示例文件：

```bash
cd frontend
copy .env.production.example .env.production
```

生产环境保持 API 地址为空，浏览器会请求 Pages 同源的 `/api/*`。Pages Function 通过 Service Binding 调用 Worker，不会让用户浏览器直接访问 `workers.dev`：

```env
VITE_API_BASE=
```

然后构建：

```bash
npm install
npm run build
```

在 `frontend` 目录运行 `wrangler pages deploy`。`frontend/wrangler.jsonc` 会把 `API` Service Binding 指向 `liwen-zhilian-api`，并连同 `functions/api/[[path]].js` 一起部署。

## 注意事项

- Worker 版上传解析当前支持 `.txt` 和 `.md`。
- 原 Express 后端仍保留在 `backend/`，本地旧方案还能继续用。
- Worker 使用 `bcryptjs`，可以兼容旧 SQLite 中 `users.password_hash` 的 bcrypt 哈希；如果要迁移旧数据，需要单独把 SQLite 数据导出并导入 D1。
- 前端本地开发时不设置 `VITE_API_BASE`，仍然通过 Vite 代理访问本地后端 `/api`。
