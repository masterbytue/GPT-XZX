# Chat 应用 —— 交接说明（给 Trae）

这是一个已经写好并验证过的 ChatGPT 风格聊天应用。请帮我在本机（**Windows 11，已装 Node.js v24**）把它跑起来。项目已在 `Downloads\chat-app` 目录下，**代码不需要重写**，主要是安装依赖 + 启动 + 排错。

---

## 一、项目概况

- **前端**：Vue 3 + Vite + Pinia + Vue Router，支持 Markdown 渲染、代码高亮、逐字流式输出。
- **后端**：Node + Express，做 BFF（backend for frontend）。负责 JWT 登录鉴权、会话/消息存储、把流式请求代理到大模型中转站（API Key 只留在后端，不进浏览器）。
- **数据库**：使用 **Node 24 内置的 SQLite**（`node:sqlite`），**不需要** `better-sqlite3`，因此**不需要 Visual Studio / node-gyp / C++ 编译工具**。
- **大模型**：接的是一个 OpenAI 兼容中转站，走 `/v1/chat/completions` 接口，默认模型 `gpt-5.4-mini`。

目录结构：

```
chat-app/
├── backend/
│   ├── .env              # 已配好中转站地址和 key，开箱即用
│   ├── .env.example
│   ├── package.json      # 依赖：express, cors, dotenv, jsonwebtoken, bcryptjs（无原生编译依赖）
│   └── src/
│       ├── index.js      # Express 服务 + SSE 流式代理
│       ├── db.js         # 用 node:sqlite 建表
│       └── auth.js       # JWT 签发与校验中间件
└── frontend/
    ├── index.html
    ├── package.json      # 依赖：vue, pinia, vue-router, markdown-it, highlight.js, vite
    ├── vite.config.js    # dev server 把 /api 代理到 http://localhost:8787
    └── src/
        ├── main.js, router.js, api.js, style.css, App.vue
        ├── views/  (Login.vue, Chat.vue)
        └── stores/ (auth.js, chat.js)
```

---

## 二、重要背景（避免踩之前踩过的坑）

1. **不要装 `better-sqlite3`。** 最初版本用了它，但它需要现场编译 C++，本机没有 Visual Studio 构建工具，`npm install` 会报 `gyp ERR! find VS / Could not find any Visual Studio installation`。现在已改用 Node 24 内置的 `node:sqlite`，完全免编译。`backend/package.json` 里已经**没有** `better-sqlite3` 依赖，启动脚本带了 `--experimental-sqlite` 标志。

2. **如果 `backend/node_modules` 已存在且是坏的**（之前失败的安装残留，会有 `EPERM` 报错），先删掉再装：
   ```
   rmdir /s /q node_modules
   del package-lock.json
   ```

3. **前后端要分别在两个终端窗口运行。** `npm run dev` 会一直占用窗口，不能用 `&&` 把两条命令串在一起。

4. **API Key 已经在 `backend/.env` 里配好了**，无需额外配置即可运行。

---

## 三、启动步骤

### 终端 1 —— 后端

```
cd %USERPROFILE%\Downloads\chat-app\backend
npm install
npm run dev
```

成功标志（出现后保持窗口开着，不要关）：

```
Backend listening on http://localhost:8787
Relay: https://jingyuqingfeng.cn/v1  Model: gpt-5.4-mini
```

### 终端 2 —— 前端（新开一个窗口）

```
cd %USERPROFILE%\Downloads\chat-app\frontend
npm install
npm run dev
```

成功标志：

```
Local:   http://localhost:5173/
```

然后浏览器打开 **http://localhost:5173** ，注册一个账号即可开始聊天。

---

## 四、验证是否正常

1. 打开 http://localhost:5173，能看到登录/注册页面。
2. 注册账号（邮箱 + 至少 6 位密码），成功后进入聊天界面。
3. 发一条消息，AI 回复应该是**逐字流式**出现的。
4. 左侧会出现会话，标题自动取自第一条消息；刷新页面后历史还在。

后端也可以单独用命令验证健康状态：浏览器访问 `http://localhost:8787/api/health`，应返回 `{"ok":true,"model":"gpt-5.4-mini"}`。

---

## 五、常见问题排查

- **后端 `npm install` 又报 node-gyp / Visual Studio 错误**：说明还在装 `better-sqlite3`。检查 `backend/package.json` 的 dependencies 里不应有 `better-sqlite3`；若有残留 `node_modules`/`package-lock.json`，按第二节第 2 点删掉重装。
- **后端启动报 `node:sqlite` 找不到或不可用**：确认 Node 版本 ≥ 22.5（`node -v`）。本机是 v24，没问题。启动脚本已带 `--experimental-sqlite`。
- **端口被占用**：后端端口在 `backend/.env` 的 `PORT` 改；前端端口在 `frontend/vite.config.js` 的 `server.port` 改（改前端端口不影响功能）。
- **前端页面能开，但发消息报错**：多半是后端没在跑，确认终端 1 那个窗口还开着且显示 listening；或检查 `backend/.env` 里的 `RELAY_API_KEY` 是否有效。
- **`npm` 不是内部命令**：Node 没进 PATH，重启终端或重装 Node 勾选 Add to PATH。

---

## 六、接口清单（供参考）

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册，返回 JWT |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/conversations` | 列出当前用户的会话 |
| POST | `/api/conversations` | 新建会话 |
| GET | `/api/conversations/:id/messages` | 某会话的所有消息 |
| PATCH | `/api/conversations/:id` | 重命名会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| POST | `/api/chat` | 发消息，SSE 流式返回 |

`/api/chat` 的 SSE 事件格式：每个 token 是 `{"type":"delta","text":"..."}`，结束时 `{"type":"done"}`，出错时 `{"type":"error","error":"..."}`。除 `/auth/*` 和 `/health` 外都需要请求头 `Authorization: Bearer <token>`。

---

## 七、安全提醒（转告我本人，Trae 不用处理）

`backend/.env` 里的中转站 token 曾经在聊天中明文出现过，建议之后去中转站后台重置一个新的，填回 `backend/.env` 的 `RELAY_API_KEY` 即可。
