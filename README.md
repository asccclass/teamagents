# TeamAgents

TeamAgents 是一個基於 Go 語言構建的高效能 AI Agent 協作平台，旨在將 AI Agent 整合為團隊成員，進行自動化任務分配、排程執行與即時狀態同步。

---

## 🏗️ 系統架構 (System Architecture)

![Agent Platform 系統架構](./agent_platform_architecture.svg)

系統採用單一整合式後端架構（Single Integrated Server），將前端單頁應用程式（SPA）、RESTful API 與 WebSocket 即時通訊整合於同一 Go 服務中：

```text
teamagents/
├── server/                  # Go 核心服務與 Daemon 守護程序
│   ├── cmd/api              # 整合式 Web / REST API / WebSocket 主入口
│   ├── cmd/daemon           # 區域 Runtime 守護程序入口
│   ├── internal/            # 業務邏輯 (Auth, Workspace, Issue, Agent, Skill, Autopilot)
│   └── migrations/          # PostgreSQL 資料庫 Schema 遷移檔
├── apps/web/public/         # 前端 SPA 靜態網頁資產 (HTML, CSS, JS)
├── deploy/                  # Nginx 與 Systemd 部署設定
├── docker-compose.yml       # Docker Compose 一鍵啟動配置
├── agent_platform_architecture.svg # 系統分層架構圖
└── makefile                 # 自動化建置指令集
```

---

## 🤖 TeamAgents Daemon 使用說明

Daemon 是運行在開發者本機（或 Worker 伺服器）上的背景執行器，負責接收網頁派發的任務並使用本機的 AI CLI（`claude`, `codex`, `cursor-agent`, `gemini`, `opencode`, `kimi`, `gh` 等）執行程式碼。Daemon 是 AI CLI 工具（claude、codex 等）和 TeamAgents Server 之間的橋樑。Server 本身不會直接呼叫 AI，而是把任務交給 Daemon 代為執行，這樣的設計讓 AI 工具可以在任何有安裝的機器上運行，不需要把 API key 集中在 Server 端。

### 1. 取得 `.env` 設定檔
在 Web 介面開啟 **Workspace -> Settings** 點擊 `Copy Daemon Env`（或手動建立 `.env`）：

```env
# TeamAgents Daemon .env
DAEMON_TOKEN=eyJhbGci...      # 從 Web 介面取得的 JWT Token
WORKSPACE_SLUG=your-workspace  # 工作區 Slug (例如 my-team)
API_BASE=https://teamagents.justdrink.com.tw
WS_URL=wss://teamagents.justdrink.com.tw/ws
AGENT_WORKDIR=/path/to/your/project # 本機要讓 AI 操作的專案目錄
```

### 2. 編譯與執行 Daemon

```bash
# 編譯 Daemon 執行檔
cd server
go build -o daemon ./cmd/daemon

# 執行 Daemon (自動載入同目錄下的 .env)
./daemon

# 或以環境變數直接啟動：
DAEMON_TOKEN="<TOKEN>" WORKSPACE_SLUG="my-team" API_BASE="https://teamagents.justdrink.com.tw" WS_URL="wss://teamagents.justdrink.com.tw/ws" AGENT_WORKDIR="/Users/name/projects/my-app" ./daemon
```

### 3. 運作機制
1. **自動 CLI 偵測**：Daemon 啟動時會自動搜尋本機 PATH 中已安裝的 CLI 工具（`claude`, `codex`, `gemini`, `cursor-agent` 等）。
2. **Runtime 登記**：自動向 Server 註冊目前主機為 Runtime 節點，可在 Web 介面 **Workspace -> Agents** 檢視連線狀態。
3. **任務即時串流**：Web 派發 Issue 給該 Agent 後，Daemon 認領任務並在本機 `AGENT_WORKDIR` 執行，同時透過 WebSocket 與 API 將 Log 即時回傳至看板。

---

## 🚀 快速開始 (Local Development)

### 1. 環境設定

複製環境變數範本並設定必要參數：

```bash
cp .env.example .env
```

確保至少包含以下核心變數：

| 變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | API & Web 服務埠號 |
| `DATABASE_URL` | `postgres://teamagents:password@localhost:5432/teamagents?sslmode=disable` | PostgreSQL 連線字串 |
| `JWT_SECRET` | *(自訂)* | JWT 身份驗證金鑰（需與 MemAuth SSO 保持一致） |
| `DEV_OTP_CODE` | `888888` | 開發環境免寄信 OTP 驗證碼 |

### 2. 啟動資料庫

使用 Docker Compose 啟動帶有 `pgvector` 擴充的 PostgreSQL：

```bash
make db-up
```

### 3. 運行伺服器 (API & Web Server)

```bash
make run-api
```

開啟瀏覽器造訪 `http://localhost:8080` 即可使用完整介面。

---

## 🛠️ 建置指令 (Build Targets)

產生無依賴的單一執行檔（Binary）：

```bash
# 建置 API & Web 伺服器
make build-api

# 建置 Daemon 執行檔
make build-daemon
```

編譯後的執行檔將輸出至 `bin/` 目錄。

---

## 🐳 Docker 部署

使用 Docker Compose 一鍵完成容器化部署：

```bash
docker compose up -d --build
```

服務預設連接埠：
* **PostgreSQL**: `localhost:5432`
* **TeamAgents 整合服務**: `http://localhost:8080`

---

## 🌐 路由劃分 (Routing)

* **`/`**：託管前端 SPA 靜態網頁與路由退回（由 `SherryServer` 處理）
* **`/api/*`**：RESTful API 存取點（Auth, Workspace, Issue, Agent, Skill, Autopilot）
* **`/ws`**：WebSocket 即時狀態與 Task 廣播頻道
