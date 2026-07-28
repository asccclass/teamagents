# TeamAgents

> AI Agents as Teammates — 把 AI Agent 變成真正的團隊成員

## 架構

```
teamagents/
├── server/                 # Go 後端
│   ├── cmd/api/            # API Server 入口
│   ├── cmd/daemon/         # Daemon 入口
│   ├── internal/
│   │   ├── auth/           # JWT + OTP 登入
│   │   ├── agent/          # Agent CRUD
│   │   ├── issue/          # Issue 看板
│   │   ├── task/           # 任務執行
│   │   ├── runtime/        # Daemon 執行環境
│   │   ├── workspace/      # 多工作區
│   │   ├── ws/             # WebSocket Hub
│   │   ├── middleware/      # JWT 驗證、Workspace 隔離
│   │   ├── config/         # 環境變數
│   │   └── db/             # 連線池 + Migration
│   └── migrations/         # SQL Schema
├── apps/web/               # Next.js 前端
│   └── src/
│       ├── app/            # App Router 頁面
│       └── lib/            # API 封裝、型別、WebSocket hook
├── deploy/                 # Dockerfile、Nginx 設定
├── scripts/                # 部署腳本
├── docker-compose.yml
└── Makefile
```

## 快速開始

### 1. 準備環境

```bash
# 複製設定
cp .env.example .env
# 編輯 .env，至少填入：
# DATABASE_URL, JWT_SECRET
```

### 2. 啟動資料庫

```bash
make db-up
```

### 3. 啟動 API Server

```bash
make run-api
# API 運行於 http://localhost:8080
```

### 4. 啟動前端

```bash
make web-install
cp apps/web/.env.local.example apps/web/.env.local
make web-dev
# 前端運行於 http://localhost:3000
```

### 5. （選擇性）啟動 Daemon

```bash
# 在你的開發機器上設定 .env
DAEMON_TOKEN=<你的JWT>
WORKSPACE_SLUG=<工作區slug>
API_BASE=http://localhost:8080

# 啟動 Daemon
go run ./server/cmd/daemon
```

## API 端點

| Method | Path | 說明 |
|--------|------|------|
| POST | /api/auth/send-otp | 發送驗證碼 |
| POST | /api/auth/verify-otp | 驗證並登入 |
| GET  | /api/auth/me | 我的資訊 |
| GET  | /api/workspaces | 我的工作區 |
| POST | /api/workspaces | 建立工作區 |
| GET  | /api/w/:ws/agents | Agent 列表 |
| POST | /api/w/:ws/agents | 建立 Agent |
| GET  | /api/w/:ws/issues | Issue 列表 |
| POST | /api/w/:ws/issues | 建立 Issue |
| PATCH | /api/w/:ws/issues/:id | 更新 Issue |
| GET  | /api/w/:ws/tasks | 任務列表 |
| POST | /api/w/:ws/tasks | 建立任務 |
| PATCH | /api/w/:ws/tasks/:id | 更新任務狀態 |
| POST | /api/w/:ws/tasks/:id/progress | 串流進度 |
| GET  | /api/w/:ws/runtimes | Runtime 列表 |
| POST | /api/w/:ws/runtimes | 登記 Runtime |
| POST | /api/w/:ws/runtimes/:id/ping | 心跳 |
| GET  | /ws | WebSocket 連線 |

## 支援的 AI Agent

| Provider | CLI Binary |
|----------|-----------|
| claude | `claude` |
| codex | `codex` |
| cursor-agent | `cursor-agent` |
| copilot | `gh` |
| opencode | `opencode` |
| gemini | `gemini` |
| kimi | `kimi` |

## 部署

```bash
# 一鍵部署
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# 或用 Docker Compose
docker compose up -d --build
```

## 網域設定

主網域：`https://teamagents.justdrink.com.tw`

Nginx 設定：`deploy/nginx.conf`
- `/` → Next.js (port 3000)
- `/api/*` → Go API (port 8080)
- `/ws` → WebSocket (port 8080)
